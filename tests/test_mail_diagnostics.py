import smtplib
import socket
import ssl
from dataclasses import replace
from email.utils import parsedate_to_datetime
from unittest.mock import MagicMock, patch

import pytest

from backend.config import Settings
from backend.manage import main
from backend.services.mail import build_message
from backend.services.mail_diagnostics import check_mail


@pytest.fixture
def smtp_settings():
    return Settings(mail_backend="smtp", smtp_host="smtp.example.org", smtp_port=587,
                    smtp_user="sender@example.org", smtp_password="not-a-real-secret",
                    mail_from="AI Sana <sender@example.org>")


def smtp_mock():
    server = MagicMock()
    server.__enter__.return_value = server
    server.noop.return_value = (250, b"OK")
    server.send_message.return_value = {}
    return server


@pytest.mark.parametrize("port", [465, 587])
def test_check_uses_verified_tls_and_login_without_sending(smtp_settings, port):
    settings = replace(smtp_settings, smtp_port=port)
    server = smtp_mock()
    target = "SMTP_SSL" if port == 465 else "SMTP"
    with patch(f"backend.services.mail.smtplib.{target}", return_value=server) as factory:
        result = check_mail(settings)
    assert result.ok
    assert "Письма не отправлялись" in result.messages[-1]
    server.send_message.assert_not_called()
    server.login.assert_called_once_with(settings.smtp_user, settings.smtp_password)
    server.noop.assert_called_once()
    server.__exit__.assert_called_once()
    assert server.starttls.call_count == (port != 465)
    context = factory.call_args.kwargs["context"] if port == 465 else server.starttls.call_args.kwargs["context"]
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED


@pytest.mark.parametrize("send_test", [False, True])
def test_file_mode_never_connects_or_sends(send_test):
    with patch("backend.services.mail_diagnostics.smtp_connection") as connection:
        result = check_mail(Settings(), send_test=send_test)
    assert not result.ok
    assert "MAIL_BACKEND=file" in result.messages[-1]
    connection.assert_not_called()


def test_explicit_test_sends_one_multipart_message_only_to_smtp_user(smtp_settings):
    server = smtp_mock()
    with patch("backend.services.mail.smtplib.SMTP", return_value=server):
        result = check_mail(smtp_settings, send_test=True)
    assert result.ok
    assert "не гарантирует" in result.messages[-1]
    server.send_message.assert_called_once()
    message = server.send_message.call_args.args[0]
    assert message["To"] == smtp_settings.smtp_user
    assert message.get_body(preferencelist=("plain",)) is not None
    assert message.get_body(preferencelist=("html",)) is not None
    assert smtp_settings.smtp_password not in message.as_string()
    assert "reset=" not in message.as_string()


def test_invalid_test_recipient_does_not_connect(smtp_settings):
    settings = replace(smtp_settings, smtp_user="a-username-without-email")
    with patch("backend.services.mail_diagnostics.smtp_connection") as connection:
        result = check_mail(settings, send_test=True)
    assert not result.ok
    assert "корректный адрес" in result.messages[-1]
    connection.assert_not_called()


@pytest.mark.parametrize("stage,error,expected", [
    ("login", smtplib.SMTPAuthenticationError(535, b"secret-content sender@example.org"), "пароль приложения"),
    ("starttls", ssl.SSLCertVerificationError("secret-content sender@example.org"), "сертификат"),
    ("starttls", smtplib.SMTPNotSupportedError("secret-content sender@example.org"), "STARTTLS"),
    ("noop", socket.gaierror("secret-content sender@example.org"), "DNS"),
    ("send_message", smtplib.SMTPRecipientsRefused({"sender@example.org": (550, b"secret-content")}), "получателя"),
    ("send_message", smtplib.SMTPSenderRefused(550, b"secret-content", "sender@example.org"), "отправителя"),
])
def test_failures_are_redacted_and_do_not_retry(smtp_settings, stage, error, expected):
    server = smtp_mock()
    getattr(server, stage).side_effect = error
    with patch("backend.services.mail.smtplib.SMTP", return_value=server):
        result = check_mail(smtp_settings, send_test=stage == "send_message")
    assert not result.ok
    output = "\n".join(result.messages)
    assert expected in output
    assert "secret-content" not in output
    assert smtp_settings.smtp_user not in output
    assert smtp_settings.smtp_password not in output
    assert server.send_message.call_count == (stage == "send_message")


def test_smtp_refusal_response_is_not_success(smtp_settings):
    server = smtp_mock()
    server.noop.return_value = (421, b"secret-content sender@example.org")
    with patch("backend.services.mail.smtplib.SMTP", return_value=server):
        result = check_mail(smtp_settings)
    assert not result.ok
    assert "421" in result.messages[-1]
    assert "secret-content" not in result.messages[-1]
    server.send_message.assert_not_called()


def test_message_headers_are_unique_and_have_valid_date(smtp_settings):
    row = {"id": 1, "recipient": "person@example.org", "subject": "Test", "body": "Body"}
    first = build_message(smtp_settings, row)
    second = build_message(smtp_settings, row)
    assert first["Message-ID"] != second["Message-ID"]
    assert parsedate_to_datetime(first["Date"]) is not None


def test_cli_check_does_not_initialize_database_or_queue(smtp_settings, capsys):
    server = smtp_mock()
    with patch("sys.argv", ["backend.manage", "check-mail"]), \
            patch("backend.manage.load_settings", return_value=smtp_settings), \
            patch("backend.manage.initialize") as initialize, \
            patch("backend.services.mail.smtplib.SMTP", return_value=server), \
            pytest.raises(SystemExit) as stopped:
        main()
    assert stopped.value.code == 0
    initialize.assert_not_called()
    server.send_message.assert_not_called()
    assert "SMTP-соединение" in capsys.readouterr().err


def test_cli_configuration_error_does_not_print_raw_exception(capsys):
    with patch("sys.argv", ["backend.manage", "check-mail"]), \
            patch("backend.manage.load_settings", side_effect=ValueError("secret-content sender@example.org")), \
            pytest.raises(SystemExit) as stopped:
        main()
    assert stopped.value.code == 2
    output = capsys.readouterr().err
    assert "Проверьте .env" in output
    assert "secret-content" not in output
    assert "sender@example.org" not in output
