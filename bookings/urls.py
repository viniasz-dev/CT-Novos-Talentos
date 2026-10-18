from . import api_admin, api_crypto, api_public

urlpatterns = api_public.urlpatterns + api_admin.urlpatterns + api_crypto.urlpatterns
