"""Local administrator tools: python -m backend.manage --help."""
import argparse
from email import policy
from email.parser import BytesParser

from .config import load_settings
from .database import connect, initialize
from .services.mail import process_outbox


def main():
    parser = argparse.ArgumentParser(description="AI Sana administrator tools")
    sub = parser.add_subparsers(dest="command", required=True)
    admin = sub.add_parser("make-admin", help="Promote an existing verified account")
    admin.add_argument("email")
    sub.add_parser("send-pending", help="Process up to 100 queued emails now")
    sub.add_parser("mail-status", help="Show the last 20 mail jobs, without message bodies")
    mail_check = sub.add_parser("check-mail", help="Check SMTP/TLS/login without sending mail or changing the queue")
    mail_check.add_argument("--send-test", action="store_true", help="Send exactly one test message to SMTP_USER")
    preview = sub.add_parser("preview-mail", help="Read a local .eml preview (file mode only)")
    preview.add_argument("id", type=int)
    args = parser.parse_args()
    try:
        settings = load_settings()
    except (ValueError, TypeError):
        parser.exit(2, "Не удалось загрузить настройки. Проверьте .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, MAIL_FROM и параметры авторизации. Значения настроек не выводятся.\n")
    if args.command == "check-mail":
        from .services.mail_diagnostics import check_mail
        result = check_mail(settings, send_test=args.send_test)
        parser.exit(0 if result.ok else 1, "\n".join(result.messages) + "\n")
    initialize(settings)
    if args.command == "make-admin":
        if settings.auth_provider == "supabase":
            parser.exit(1, "Use the verified-email administrator SQL in docs/SUPABASE_SETUP.md.\n")
        with connect(settings) as db:
            result = db.execute("UPDATE users SET role = 'admin' WHERE email = ? AND email_verified = 1", (args.email.strip().lower(),))
            if result.rowcount != 1:
                parser.exit(1, "Account not found or email has not been verified.\n")
        print("Administrator role assigned.")
    elif args.command == "send-pending":
        print(f"Processed: {process_outbox(settings, batch_size=100)}")
    elif args.command == "mail-status":
        if settings.auth_provider == "supabase":
            from .services.supabase_gateway import api_call
            for row in api_call(settings, "GET", "/rest/v1/mail_outbox", admin=True,
                                params={"select": "id,status,attempts,last_error", "order": "id.desc", "limit": "20"}):
                print(row)
        else:
            with connect(settings) as db:
                for row in db.execute("SELECT id, status, attempts, last_error FROM outbox ORDER BY id DESC LIMIT 20"):
                    print(dict(row))
    else:
        if settings.mail_backend != "file":
            parser.exit(1, "Preview is available only with MAIL_BACKEND=file.\n")
        path = settings.mail_directory / f"{args.id:08d}.eml"
        if not path.is_file():
            parser.exit(1, "Preview not found. Check mail-status or run send-pending.\n")
        message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
        print(message.get_body(preferencelist=("plain",)).get_content())


if __name__ == "__main__":
    main()
