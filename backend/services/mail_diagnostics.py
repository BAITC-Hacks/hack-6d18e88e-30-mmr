"""Explicit administrator SMTP checks. No database or mail queue access."""
import smtplib
import socket
import ssl
from dataclasses import dataclass

from pydantic import EmailStr, TypeAdapter, ValidationError

from ..config import Settings
from .mail import build_message, smtp_connection


@dataclass(frozen=True)
class MailCheckResult:
    ok: bool
    messages: tuple[str, ...]


def safe_mail_error(error: Exception) -> str:
    """Never include exception text: SMTP errors can contain addresses or credentials."""
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return "SMTP отклонил авторизацию. Проверьте SMTP_USER и SMTP_PASSWORD; для Gmail нужен пароль приложения, а не пароль аккаунта."
    if isinstance(error, ssl.SSLCertVerificationError):
        return "Не удалось проверить TLS-сертификат SMTP. Проверьте имя сервера, дату компьютера и доверенные сертификаты; не отключайте проверку TLS."
    if isinstance(error, ssl.SSLError):
        return "Не удалось установить TLS-соединение. Проверьте SMTP_HOST и SMTP_PORT: 465 — SSL, 587 — STARTTLS."
    if isinstance(error, smtplib.SMTPNotSupportedError):
        return "SMTP-сервер не поддерживает STARTTLS или нужный способ авторизации. Проверьте настройки провайдера и порт."
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return "SMTP отклонил адрес получателя тестового письма. Проверьте SMTP_USER и ограничения почтового сервиса."
    if isinstance(error, smtplib.SMTPSenderRefused):
        return "SMTP отклонил отправителя. MAIL_FROM должен быть адресом, разрешённым вашим почтовым сервисом."
    if isinstance(error, smtplib.SMTPDataError):
        return "SMTP отклонил письмо. Проверьте лимиты отправки и разрешение отправителя в почтовом сервисе."
    if isinstance(error, socket.gaierror):
        return "Не удалось найти SMTP-сервер. Проверьте SMTP_HOST, DNS и подключение к интернету."
    if isinstance(error, TimeoutError):
        return "Истекло время ожидания SMTP. Проверьте сеть, SMTP_HOST, SMTP_PORT и доступ через брандмауэр."
    if isinstance(error, ConnectionRefusedError):
        return "SMTP-соединение отклонено. Проверьте адрес, порт сервера и сетевые ограничения."
    if isinstance(error, smtplib.SMTPServerDisconnected):
        return "SMTP-сервер разорвал соединение. Проверьте порт и настройки TLS, затем повторите проверку."
    if isinstance(error, smtplib.SMTPResponseException):
        code = error.smtp_code
        suffix = f" (код {code})" if isinstance(code, int) and 100 <= code <= 599 else ""
        return f"SMTP-сервер отклонил проверку{suffix}. Проверьте настройки и ограничения почтового сервиса."
    if isinstance(error, OSError):
        return "Не удалось соединиться с SMTP. Проверьте сеть и настройки почтового сервера."
    return "Проверка SMTP не завершилась. Проверьте настройки почты и повторите команду."


def check_mail(settings: Settings, *, send_test: bool = False) -> MailCheckResult:
    messages = []
    if settings.auth_provider == "supabase":
        messages.append("Этот SMTP используется бэкендом для рассылок. Подтверждение почты и сброс пароля отправляет Supabase со своими SMTP-настройками.")
    if settings.mail_backend == "file":
        messages.append("MAIL_BACKEND=file: письма сохраняются как локальные .eml, а на почту не отправляются. Заполните SMTP-настройки и включите MAIL_BACKEND=smtp.")
        return MailCheckResult(False, tuple(messages))
    if not settings.mail_worker_enabled:
        messages.append("MAIL_WORKER_ENABLED=false: фоновая отправка очереди выключена. Эта команда проверяет SMTP независимо от очереди.")
    recipient = None
    if send_test:
        try:
            recipient = str(TypeAdapter(EmailStr).validate_python(settings.smtp_user))
        except ValidationError:
            messages.append("Для --send-test SMTP_USER должен содержать корректный адрес вашей почты. Письмо не отправлено.")
            return MailCheckResult(False, tuple(messages))
    try:
        with smtp_connection(settings) as server:
            code, _ = server.noop()
            if code != 250:
                raise smtplib.SMTPResponseException(code, b"SMTP check rejected")
            if send_test:
                message = build_message(settings, {
                    "recipient": recipient,
                    "subject": "AI Sana — проверка отправки писем",
                    "body": "Это тестовое письмо AI Sana. SMTP-подключение работает. В письме нет паролей или ссылок для входа. Никаких действий не требуется.",
                    "html_body": '<!doctype html><html lang="ru"><body style="margin:0;padding:32px;background:#f4f3e9;font-family:Arial,sans-serif;color:#183c2e"><h1>AI Sana</h1><h2>Проверка отправки писем</h2><p>SMTP-подключение работает.</p><p>В письме нет паролей или ссылок для входа. Никаких действий не требуется.</p></body></html>',
                })
                refused = server.send_message(message)
                if refused:
                    raise smtplib.SMTPRecipientsRefused(refused)
    except Exception as error:
        messages.append(safe_mail_error(error))
        return MailCheckResult(False, tuple(messages))
    if send_test:
        messages.append("SMTP принял одно тестовое письмо для адреса SMTP_USER. Это не гарантирует попадание во «Входящие»: проверьте почту и папку «Спам».")
    else:
        auth_status = "Авторизация выполнена." if settings.smtp_user else "Авторизация не настроена; проверено только соединение."
        messages.append(f"SMTP-соединение и TLS работают. {auth_status} Письма не отправлялись, очередь не изменялась.")
    return MailCheckResult(True, tuple(messages))
