from django import forms
from django.contrib import admin, messages

from common.http import ApiError

from . import services
from .models import AuditEvent, BookingRequest, Field, TimeBlock


@admin.register(Field)
class FieldAdmin(admin.ModelAdmin):
    list_display = ("name", "price_per_hour", "active")
    list_filter = ("active",)
    search_fields = ("name",)


def _run_status_action(modeladmin, request, queryset, status, verb):
    done = 0
    for booking in queryset.select_related("field").order_by("pk"):
        try:
            services.set_status(booking, status, request.user)
            done += 1
        except ApiError as exc:
            modeladmin.message_user(
                request, f"Pedido #{booking.pk} não foi {verb}: {exc.message}",
                level=messages.WARNING)
    if done:
        modeladmin.message_user(request, f"{done} pedido(s) {verb}(s).",
                                level=messages.SUCCESS)


@admin.register(BookingRequest)
class BookingRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "field", "start", "end", "status", "user")
    list_filter = ("status", "field", ("start", admin.DateFieldListFilter))
    list_select_related = ("field", "user")
    actions = ("approve", "reject", "cancel")
    # contato e mensagem cifrados nunca aparecem; estado so muda por services
    fields = ("user", "field", "start", "end", "status", "decided_by",
              "created_at", "updated_at")
    readonly_fields = fields

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @admin.action(description="Aprovar")
    def approve(self, request, queryset):
        _run_status_action(self, request, queryset, "aprovado", "aprovado")

    @admin.action(description="Recusar")
    def reject(self, request, queryset):
        _run_status_action(self, request, queryset, "recusado", "recusado")

    @admin.action(description="Cancelar")
    def cancel(self, request, queryset):
        _run_status_action(self, request, queryset, "cancelado", "cancelado")


class TimeBlockForm(forms.ModelForm):
    class Meta:
        model = TimeBlock
        fields = ("field", "start", "end", "reason")

    def clean(self):
        cleaned = super().clean()
        field, start, end = (cleaned.get("field"), cleaned.get("start"),
                             cleaned.get("end"))
        if field and start and end:
            try:
                services._check_range(start, end)
            except ApiError as exc:
                raise forms.ValidationError(exc.message) from None
            found = services.find_conflicts(field, start, end)
            if found["bookings"]:
                raise forms.ValidationError(
                    "Existem reservas aprovadas neste intervalo: "
                    + ", ".join(f"#{b.pk}" for b in found["bookings"]))
        return cleaned


@admin.register(TimeBlock)
class TimeBlockAdmin(admin.ModelAdmin):
    form = TimeBlockForm
    list_display = ("field", "start", "end", "reason", "created_by")
    list_filter = ("field",)

    def get_readonly_fields(self, request, obj=None):
        # intervalo/campo so mudam recriando o bloqueio (via services)
        return ("field", "start", "end") if obj else ()

    def get_form(self, request, obj=None, **kwargs):
        if obj:
            kwargs["fields"] = ("reason",)
        return super().get_form(request, obj, **kwargs)

    def save_model(self, request, obj, form, change):
        if change:
            obj.save(update_fields=["reason"])
            return
        try:
            created = services.create_block(
                obj.field, obj.start, obj.end, obj.reason, request.user)
        except ApiError as exc:
            self.message_user(request, exc.message, level=messages.ERROR)
            raise
        obj.pk = created.pk
        obj.created_by = created.created_by
        obj.created_at = created.created_at
        obj._state.adding = False
        obj._state.db = created._state.db

    def delete_model(self, request, obj):
        services.delete_block(obj, request.user)

    def delete_queryset(self, request, queryset):
        for block in queryset.select_related("field"):
            services.delete_block(block, request.user)


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "object_type", "object_id")
    list_filter = ("action", "object_type")
    readonly_fields = ("actor", "action", "object_type", "object_id", "meta",
                       "created_at")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
