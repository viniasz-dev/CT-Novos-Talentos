from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/", include("accounts.urls")),
    path("api/", include("bookings.urls")),
    path("senha/", include("accounts.password_urls")),
    path("", include("site_pages.urls")),
]
