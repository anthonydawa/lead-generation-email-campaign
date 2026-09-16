"""Campaign template rendering."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


TEMPLATE_TAG = re.compile(r"{{\s*([^{}]+?)\s*}}")

TEMPLATE_ALIASES = {
    "firstname": "first_name",
    "first_name": "first_name",
    "lastname": "last_name",
    "last_name": "last_name",
    "company": "company",
    "email": "email",
    "yourname": "sender_name",
    "your_name": "sender_name",
    "sendername": "sender_name",
    "sender_name": "sender_name",
}

TEMPLATE_FALLBACKS = {
    "first_name": "there",
    "company": "your agency",
    "sender_name": "Anthony",
}


def render_template(template: str, lead: Mapping[str, Any]) -> str:
    """Render canonical and human-readable tags without leaking placeholders."""

    def replacement(match: re.Match[str]) -> str:
        raw_key = match.group(1).strip().lower()
        normalized_key = re.sub(r"[\s-]+", "_", raw_key)
        compact_key = re.sub(r"[^a-z0-9]", "", raw_key)
        key = TEMPLATE_ALIASES.get(normalized_key) or TEMPLATE_ALIASES.get(compact_key)
        if not key:
            return ""
        value = lead.get(key)
        return str(value).strip() if value else TEMPLATE_FALLBACKS.get(key, "")

    return TEMPLATE_TAG.sub(replacement, template)
