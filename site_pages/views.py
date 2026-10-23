from django.views.generic import TemplateView


def page(template_name):
    return TemplateView.as_view(template_name=f"pages/{template_name}.html")


index = page("index")
sobre = page("sobre")
servicos = page("servicos")
contato = page("contato")
entrar = page("entrar")
cadastro = page("cadastro")
reservar = page("reservar")
minhas_reservas = page("minhas_reservas")
painel = page("painel")
