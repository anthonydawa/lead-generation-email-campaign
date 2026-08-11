"""Campaign template rendering."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any


TEMPLATE_TAG = re.compile(r"{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}")


def render_template(template: str, lead: Mapping[str, Any]) -> str:
    """Replace known tags with lead values and unknown tags with an empty string."""

    return TEMPLATE_TAG.sub(lambda match: str(lead.get(match.group(1)) or ""), template)
