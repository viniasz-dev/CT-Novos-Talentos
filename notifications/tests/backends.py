import socket
from smtplib import SMTPException

from django.core.mail.backends.base import BaseEmailBackend


class Boom(BaseEmailBackend):
    def send_messages(self, email_messages):
        raise SMTPException("senha=abc")


class Timeout(BaseEmailBackend):
    def send_messages(self, email_messages):
        raise socket.timeout("timed out smtp.interno:587")
