#!/usr/bin/env python3
"""Export a Telegram chat to Markdown."""

import asyncio
import os
import sys
from datetime import datetime, timezone

from telethon import TelegramClient
from telethon.tl.types import (
    MessageMediaDocument,
    MessageMediaPhoto,
    MessageMediaWebPage,
    User,
)

CHAT_TITLE = "Датавед"
OUTPUT_FILE = "klsh-info.md"
API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]


def sender_name(msg) -> str:
    sender = msg.sender
    if sender is None:
        return "Unknown"
    if isinstance(sender, User):
        parts = [sender.first_name or "", sender.last_name or ""]
        name = " ".join(p for p in parts if p).strip()
        return name or sender.username or str(sender.id)
    return getattr(sender, "title", None) or str(sender.id)


def media_tag(msg) -> str:
    m = msg.media
    if m is None:
        return ""
    if isinstance(m, MessageMediaPhoto):
        return " `[photo]`"
    if isinstance(m, MessageMediaDocument):
        mime = getattr(m.document, "mime_type", "")
        if mime.startswith("video"):
            return " `[video]`"
        if mime.startswith("audio") or mime == "application/ogg":
            return " `[audio]`"
        return " `[file]`"
    if isinstance(m, MessageMediaWebPage):
        return ""
    return " `[media]`"


async def find_chat(client, title: str):
    async for dialog in client.iter_dialogs():
        if dialog.name == title:
            return dialog.entity
    return None


async def main():
    async with TelegramClient("session", API_ID, API_HASH) as client:
        print(f"Searching for chat: {CHAT_TITLE!r}")
        chat = await find_chat(client, CHAT_TITLE)
        if chat is None:
            print(f"Chat not found: {CHAT_TITLE!r}", file=sys.stderr)
            sys.exit(1)

        print(f"Found: {CHAT_TITLE}. Fetching messages...")

        messages = []
        async for msg in client.iter_messages(chat, reverse=True):
            messages.append(msg)

        print(f"Fetched {len(messages)} messages. Writing {OUTPUT_FILE}...")

        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(f"# {CHAT_TITLE}\n\n")
            f.write(f"Exported {len(messages)} messages on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n\n")
            f.write("---\n\n")

            current_date = None
            for msg in messages:
                if msg.date is None:
                    continue

                msg_date = msg.date.astimezone(timezone.utc).date()
                if msg_date != current_date:
                    current_date = msg_date
                    f.write(f"\n## {msg_date.strftime('%Y-%m-%d')}\n\n")

                ts = msg.date.astimezone(timezone.utc).strftime("%H:%M")
                name = sender_name(msg)
                text = (msg.text or "").strip()
                tag = media_tag(msg)

                if not text and not tag:
                    continue

                if msg.reply_to_msg_id:
                    f.write(f"**{name}** `{ts}` _(reply)_{tag}\n")
                else:
                    f.write(f"**{name}** `{ts}`{tag}\n")

                if text:
                    for line in text.splitlines():
                        f.write(f"> {line}\n")

                f.write("\n")

        print(f"Done → {OUTPUT_FILE}")


asyncio.run(main())
