import unittest

from templating import render_template


class TemplatingTests(unittest.TestCase):
    def test_human_readable_aliases_are_rendered(self) -> None:
        rendered = render_template(
            "Hi {{First Name}} from {{Company}} — {{Your Name}} / {{unknown tag}}",
            {"first_name": "Ada", "company": None},
        )
        self.assertEqual(rendered, "Hi Ada from your agency — Anthony / ")
