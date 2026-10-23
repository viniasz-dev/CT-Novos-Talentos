import re

from django.contrib.staticfiles import finders
from django.test import TestCase

PAGES = [
    "/", "/sobre/", "/servicos/", "/contato/", "/entrar/", "/cadastro/",
    "/reservar/", "/minhas-reservas/", "/painel/",
]

REDESIGNED = ["/", "/sobre/", "/servicos/", "/contato/", "/entrar/", "/cadastro/"]

NAV_LINKS = ['href="/"', 'href="/sobre/"', 'href="/servicos/"', 'href="/contato/"']

CSS_FILES = ["tokens.css", "base.css", "components.css", "pages.css", "crypto.css"]


def _input_tag(html: str, name: str) -> str:
    match = re.search(r'<input[^>]*\bname="%s"[^>]*>' % re.escape(name), html)
    assert match, f"input {name} not found"
    return match.group(0)


class PagesTests(TestCase):
    def test_pages_ok(self):
        for path in PAGES:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_password_reset_pages_ok(self):
        for path in ("/senha/reset/", "/senha/reset/enviado/", "/senha/reset/concluido/"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertContains(response, '<main id="main"')
                self.assertContains(response, "<h1")

    def test_static_assets_referenced_exist(self):
        for rel in (
            "imgs/logo.png",
            "imgs/WhatsApp Image 2026-05-01 at 18.58.22.jpeg",
            "video/fut.mp4",
            "css/app.css",
            *(f"css/{name}" for name in CSS_FILES),
            "js/api.js",
            "js/ui.js",
            "js/auth.js",
            "js/home.js",
        ):
            with self.subTest(rel=rel):
                self.assertIsNotNone(finders.find(rel))

    def test_old_stylesheet_removed(self):
        self.assertIsNone(finders.find("css/style.css"))
        self.assertNotContains(self.client.get("/"), "style.css")

    def test_app_css_imports_every_layer(self):
        with open(finders.find("css/app.css"), encoding="utf-8") as fh:
            css = fh.read()
        for name in CSS_FILES:
            with self.subTest(name=name):
                self.assertIn(name, css)

    def test_base_has_auth_nav_slot(self):
        self.assertContains(self.client.get("/"), "data-auth-nav")

    def test_every_page_has_landmarks(self):
        for path in PAGES:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertContains(response, '<html lang="pt-BR">')
                self.assertContains(response, '<main id="main"', count=1)
                self.assertContains(response, 'href="#main"')
                self.assertContains(response, "Pular para o conteúdo")
                self.assertContains(response, "css/app.css")
                self.assertContains(response, "js/auth.js")
                self.assertContains(response, 'type="module"')
                for link in NAV_LINKS:
                    self.assertContains(response, link)
                self.assertContains(response, 'aria-controls="menu-principal"')

    def test_redesigned_pages_have_single_h1(self):
        for path in REDESIGNED:
            with self.subTest(path=path):
                html = self.client.get(path).content.decode()
                self.assertEqual(len(re.findall(r"<h1[\s>]", html)), 1)

    def test_current_page_marked_in_nav(self):
        self.assertContains(self.client.get("/sobre/"), 'href="/sobre/" aria-current="page"')

    def test_home_has_fields_and_quick_search(self):
        response = self.client.get("/")
        self.assertContains(response, 'id="campos"')
        self.assertContains(response, 'id="busca-rapida"')
        html = response.content.decode()
        form = re.search(r'<form[^>]*id="busca-rapida"[^>]*>', html).group(0)
        self.assertIn('action="/reservar/"', form)
        self.assertIn('method="get"', form)
        self.assertIn('type="date"', _input_tag(html, "date"))
        self.assertContains(response, "Reservar horário")
        self.assertContains(response, "js/home.js")
        for price in ("R$ 150,00", "R$ 600,00", "R$ 30,00", "Sob consulta"):
            self.assertContains(response, price)
        for item in ("Lanchonete", "Churrasqueira", "Área de resenha"):
            self.assertContains(response, item)

    def test_home_video_has_no_autoplay_attribute(self):
        # Playback starts in JS only when prefers-reduced-motion allows it.
        html = self.client.get("/").content.decode()
        video = re.search(r"<video[^>]*>", html).group(0)
        self.assertNotIn("autoplay", video)
        self.assertIn("muted", video)
        self.assertIn("poster=", video)

    def test_home_has_empty_and_error_state_templates(self):
        response = self.client.get("/")
        self.assertContains(response, '<template data-state="empty">')
        self.assertContains(response, '<template data-state="error">')
        self.assertContains(response, "data-retry")
        self.assertContains(response, "Tentar de novo")
        self.assertContains(response, "data-campos-list")
        self.assertContains(response, "data-campos-status")
        self.assertContains(response, "data-campos-skeleton")

    def test_video_toggle_uses_label_only(self):
        html = self.client.get("/").content.decode()
        toggle = re.search(r"<button[^>]*data-video-toggle[^>]*>", html).group(0)
        self.assertNotIn("aria-pressed", toggle)

    def test_js_class_not_set_before_modules_run(self):
        # The .js class (which hides the mobile menu) is set by initMenu() in a module,
        # so a module that fails to load leaves the nav visible.
        html = self.client.get("/").content.decode()
        head = html.split("</head>")[0]
        self.assertNotIn('classList.add("js")', head)

    def test_footer_hours_only_from_spec(self):
        response = self.client.get("/")
        self.assertContains(response, "Segunda a sexta: 18h às 23h")
        self.assertNotContains(response, "Sábado")
        self.assertNotContains(response, "domingo")

    def test_servicos_cards_link_to_reservar(self):
        response = self.client.get("/servicos/")
        self.assertContains(response, 'href="/reservar/"')
        for price in ("R$ 150,00", "R$ 600,00", "Sob consulta"):
            self.assertContains(response, price)

    def test_contato_uses_whatsapp_and_map(self):
        response = self.client.get("/contato/")
        self.assertContains(response, "https://wa.me/5519999117711")
        self.assertContains(response, "<iframe")
        self.assertContains(response, 'id="form-contato"')
        self.assertNotContains(response, "mailto:")
        html = response.content.decode()
        alert = re.search(r"<div[^>]*data-form-error[^>]*>", html).group(0)
        self.assertIn('role="alert"', alert)

    def test_entrar_form(self):
        response = self.client.get("/entrar/")
        html = response.content.decode()
        form = re.search(r'<form[^>]*id="form-entrar"[^>]*>', html).group(0)
        self.assertIn("novalidate", form)
        self.assertIn('autocomplete="username"', _input_tag(html, "email"))
        self.assertIn('autocomplete="current-password"', _input_tag(html, "password"))
        self.assertContains(response, 'href="/senha/reset/"')
        self.assertContains(response, 'href="/cadastro/"')

    def test_cadastro_form(self):
        response = self.client.get("/cadastro/")
        html = response.content.decode()
        form = re.search(r'<form[^>]*id="form-cadastro"[^>]*>', html).group(0)
        self.assertIn("novalidate", form)
        self.assertIn('autocomplete="name"', _input_tag(html, "name"))
        self.assertIn('autocomplete="email"', _input_tag(html, "email"))
        self.assertIn('autocomplete="tel"', _input_tag(html, "phone"))
        self.assertIn('autocomplete="new-password"', _input_tag(html, "password"))
        self.assertContains(response, 'href="/entrar/"')

    def test_app_pages_have_single_h1(self):
        for path in ("/reservar/", "/minhas-reservas/", "/painel/"):
            with self.subTest(path=path):
                html = self.client.get(path).content.decode()
                self.assertEqual(len(re.findall(r"<h1[\s>]", html)), 1)

    def test_app_scripts_exist(self):
        for rel in ("js/calendar.js", "js/booking.js", "js/account.js", "js/panel.js"):
            with self.subTest(rel=rel):
                self.assertIsNotNone(finders.find(rel))

    def test_reservar_has_flow_containers(self):
        response = self.client.get("/reservar/")
        for anchor in ('id="campos-reserva"', 'id="calendario"', 'id="horarios"', 'id="resumo"',
                       'id="form-reserva"', "js/booking.js"):
            with self.subTest(anchor=anchor):
                self.assertContains(response, anchor)
        html = response.content.decode()
        self.assertIn('name="contact"', html)
        self.assertIn('maxlength="120"', _input_tag(html, "contact"))
        textarea = re.search(r'<textarea[^>]*name="message"[^>]*>', html).group(0)
        self.assertIn('maxlength="500"', textarea)
        # estados vazio/erro e legenda da grade
        self.assertContains(response, 'data-state="empty"')
        self.assertContains(response, 'data-state="error"')
        self.assertContains(response, "https://wa.me/5519999117711")
        for label in ("Livre", "Ocupado", "Bloqueado"):
            self.assertContains(response, label)

    def test_minhas_reservas_has_list_and_filter(self):
        response = self.client.get("/minhas-reservas/")
        self.assertContains(response, 'id="lista-reservas"')
        self.assertContains(response, 'id="filtro-status"')
        self.assertContains(response, "js/account.js")
        for value in ("pendente", "aprovado", "recusado", "cancelado"):
            self.assertContains(response, f'value="{value}"')

    def test_painel_has_tabs_and_no_data_in_html(self):
        response = self.client.get("/painel/")
        self.assertContains(response, 'id="painel-abas"')
        self.assertContains(response, 'role="tablist"')
        for tab in ("Kanban", "Pedidos", "Bloqueios", "Agenda"):
            self.assertContains(response, tab)
        self.assertContains(response, "js/panel.js")
        self.assertContains(response, "data-panel-denied")
        # o conteúdo do painel começa escondido até o JS confirmar que é staff
        html = response.content.decode()
        shell = re.search(r'<div[^>]*data-panel-shell[^>]*>', html).group(0)
        self.assertIn("hidden", shell)
        panels = re.findall(r'<section[^>]*role="tabpanel"[^>]*>', html)
        self.assertEqual(len(panels), 4)
        # Kanban é a primeira aba e a única visível de início
        first_tab = re.search(r'<button[^>]*role="tab"[^>]*>', html).group(0)
        self.assertIn('data-tab="kanban"', first_tab)
        self.assertIn('aria-selected="true"', first_tab)
        self.assertNotIn("hidden", panels[0])
        for panel in panels[1:]:
            self.assertIn("hidden", panel)
        for name in ('name="date_from"', 'name="date_to"', 'name="q"', "data-kanban-board",
                     "data-kanban-live"):
            self.assertIn(name, html)
        for panel in panels:
            self.assertIn('tabindex="0"', panel)
        self.assertNotIn("Django", html.split("<main")[1].split("</main>")[0])

    def test_password_toggles_are_buttons(self):
        for path in ("/entrar/", "/cadastro/"):
            with self.subTest(path=path):
                self.assertContains(self.client.get(path), 'data-toggle-password')


class StaffPagesTests(TestCase):
    """A equipe não reserva: /reservar/ vira "Bloquear horário" e a navegação muda."""

    def setUp(self):
        from accounts.models import User
        self.staff = User.objects.create_user("eq@x.test", "pw-12345-Abc", name="Equipe",
                                              is_staff=True)
        self.client_user = User.objects.create_user("c@x.test", "pw-12345-Abc", name="Cli")

    def test_reservar_block_mode_for_staff(self):
        self.client.force_login(self.staff)
        html = self.client.get("/reservar/").content.decode()
        self.assertIn('data-mode="block"', html)
        self.assertIn('<h1 id="reservar-titulo">Bloquear horário</h1>', html)
        self.assertIn('name="reason"', html)
        self.assertIn('maxlength="200"', _input_tag(html, "reason"))
        self.assertIn("data-reason-suggestion", html)
        self.assertIn("data-block-view", html)
        self.assertNotIn('name="contact"', html)
        self.assertNotIn('name="message"', html)
        self.assertNotIn("data-sum-total", html)
        self.assertNotIn("Enviar pedido", html)
        self.assertEqual(len(re.findall(r"<h1[\s>]", html)), 1)

    def test_reservar_unchanged_for_clients_and_anonymous(self):
        for user in (None, self.client_user):
            with self.subTest(user=user):
                if user:
                    self.client.force_login(user)
                html = self.client.get("/reservar/").content.decode()
                self.assertIn('data-mode="booking"', html)
                self.assertIn('<h1 id="reservar-titulo">Reservar horário</h1>', html)
                self.assertIn('name="contact"', html)
                self.assertIn("Enviar pedido", html)
                self.assertNotIn('name="reason"', html)

    def test_staff_nav_and_ctas(self):
        self.client.force_login(self.staff)
        html = self.client.get("/").content.decode()
        header = html.split("<main")[0]
        self.assertIn(">Bloquear horário</a>", header)
        self.assertNotIn("Minhas reservas", header)
        self.assertIn('href="/painel/"', header)
        self.assertNotIn(">Reservar horário</a>", html)

    def test_client_nav_keeps_reservar(self):
        self.client.force_login(self.client_user)
        header = self.client.get("/").content.decode().split("<main")[0]
        self.assertIn(">Reservar</a>", header)
        self.assertIn("Minhas reservas", header)

    def test_minhas_reservas_staff_notice(self):
        self.client.force_login(self.staff)
        html = self.client.get("/minhas-reservas/").content.decode()
        self.assertIn("data-staff-notice", html)
        self.assertIn("A equipe não faz reservas", html)
        self.assertIn('href="/painel/"', html)
        self.assertNotIn("js/account.js", html)
        self.assertNotIn('id="lista-reservas"', html)
        self.client.force_login(self.client_user)
        html = self.client.get("/minhas-reservas/").content.decode()
        self.assertIn("js/account.js", html)
        self.assertNotIn("data-staff-notice", html)


class CryptoPageTests(TestCase):
    def test_crypto_page_removed(self):
        self.assertEqual(self.client.get("/criptografia/").status_code, 404)

    def test_painel_has_kpis_and_no_crypto_tab(self):
        r = self.client.get("/painel/")
        self.assertNotContains(r, 'data-tab="cripto"')
        self.assertContains(r, "data-kpis")


def _root_classes(css: str) -> set:
    """Primeira classe de cada seletor que começa uma linha (`.nome ...{` ou `.nome,`)."""
    return set(re.findall(r"^\s*\.([A-Za-z][\w-]*)", css, flags=re.M))


class CryptoCssTests(TestCase):
    # Sobrescritas intencionais de componentes existentes.
    ALLOWED = {"order__contact"}

    def test_crypto_css_classes_do_not_collide(self):
        # Regressão: `.steps` da tabela passo a passo colidia com `.steps` da home
        # (display:grid) e a tabela saía quebrada no navegador.
        def read(name):
            with open(finders.find(f"css/{name}"), encoding="utf-8") as fh:
                return fh.read()

        mine = _root_classes(read("crypto.css"))
        others = set()
        for name in ("base.css", "components.css", "pages.css"):
            others |= _root_classes(read(name))
        self.assertEqual((mine & others) - self.ALLOWED, set())
