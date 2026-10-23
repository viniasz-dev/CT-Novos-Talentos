from django.urls import path

from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("sobre/", views.sobre, name="sobre"),
    path("servicos/", views.servicos, name="servicos"),
    path("contato/", views.contato, name="contato"),
    path("cookies/", views.cookies, name="cookies"),
    path("criptografia/", views.criptografia, name="criptografia"),
    path("entrar/", views.entrar, name="entrar"),
    path("cadastro/", views.cadastro, name="cadastro"),
    path("reservar/", views.reservar, name="reservar"),
    path("minhas-reservas/", views.minhas_reservas, name="minhas_reservas"),
    path("painel/", views.painel, name="painel"),
]
