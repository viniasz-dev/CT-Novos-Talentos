from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("bookings", "0002_default_field")]
    operations = [
        migrations.AddField("bookingrequest", "kind", models.CharField(
            max_length=10, default="avulsa",
            choices=[("avulsa", "Avulsa"), ("mensal", "Mensal"), ("torneio", "Torneio")])),
        migrations.AddField("bookingrequest", "series", models.CharField(
            max_length=36, blank=True, default="")),
    ]
