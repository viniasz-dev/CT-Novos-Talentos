from django.db import migrations


def create_field(apps, schema_editor):
    Field = apps.get_model("bookings", "Field")
    if not Field.objects.exists():
        Field.objects.create(name="Campo Society", price_per_hour="150.00", active=True,
                             description="Campo society do CT Novos Talentos.")


class Migration(migrations.Migration):
    dependencies = [("bookings", "0001_initial")]
    operations = [migrations.RunPython(create_field, migrations.RunPython.noop)]
