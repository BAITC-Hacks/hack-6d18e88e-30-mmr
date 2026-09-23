"""HTML counterpart for local development / self-hosted auth emails."""
from html import escape


def action_email(title: str, description: str, link: str, button: str, minutes: int) -> str:
    title, description, link, button = map(escape, (title, description, link, button))
    return f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f4ed;font-family:Arial,sans-serif;color:#173b30">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f4ed"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#fff;border:1px solid #dfe6dc;border-radius:20px">
<tr><td style="padding:36px 36px 20px;font-size:14px;font-weight:bold;letter-spacing:3px">AI SANA <span style="color:#819185;font-weight:normal;letter-spacing:0">/ TaskRank</span></td></tr>
<tr><td style="padding:0 36px"><h1 style="font-size:28px;line-height:1.25;margin:12px 0 20px">{title}</h1>
<p style="font-size:16px;line-height:1.7;color:#52675b">{description}</p></td></tr>
<tr><td style="padding:24px 36px"><a href="{link}" style="display:inline-block;padding:16px 24px;background:#1f5c43;color:#fff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:bold">{button} &#8594;</a></td></tr>
<tr><td style="padding:0 36px 32px;color:#65776a;font-size:13px;line-height:1.7">
Ссылка действует {minutes} минут и только один раз. Если вы не запрашивали это письмо, просто проигнорируйте его.<br><br>
Если кнопка не открывается, скопируйте ссылку:<br><a href="{link}" style="color:#1f5c43;word-break:break-all">{link}</a></td></tr>
</table><p style="color:#7e8b7e;font-size:12px;margin:24px 0">AI Sana · Здесь задачи становятся возможностями.</p>
</td></tr></table></body></html>'''
