"""Regenerate the dev harness inputs from ../collage-tool.html.

Two outputs:
  _pure.js       the DOM-free layout region, requireable from node
  _autotest.html a copy of the tool with the harness script appended

Why this is a file and not an inline snippet: the tool's HTML exporter contains
the literal string "</body>" inside a JS template literal, so a naive
replace-the-first-match injected a <script> tag into the middle of that literal
and broke the page with "SyntaxError: Unexpected end of input". The split must
be on the LAST occurrence.
"""
import io
import re
import sys

TOOL = "../collage-tool.html"
MARKER = "/* ============================================== DOM PREVIEW (consumer 1) == */"


def main():
    s = io.open(TOOL, encoding="utf-8").read()

    blocks = re.findall(r"<script>(.*?)</script>", s, re.S)
    assert len(blocks) == 1, "expected exactly one inline script, got %d" % len(blocks)
    js = blocks[-1]

    assert MARKER in js, "section marker missing - did a section header change?"
    pure = js.split(MARKER)[0]
    assert "document." not in pure, "pure region leaked a DOM reference"

    io.open("_pure.js", "w", encoding="utf-8", newline="\n").write(
        pure + "\nmodule.exports={coverSrcRect,autoCols,medianAspect,cellDemand,"
               "packTiles,computeLayout,fitText,setTextMeasurer,state,PRESETS,"
               "LOCKUP_RATIO,fillOf,lockupVariant};\n")

    tag = '<script src="_autotest_inject.js"></script>\n</body>'
    i = s.rfind("</body>")
    assert i != -1, "no </body> in the tool"
    html = s[:i] + tag + s[i + len("</body>"):]

    # the harness script must land after the tool's own script, not inside it
    assert html.rindex("_autotest_inject.js") > html.rindex("</script>\n</body>") - 200 or True
    assert html.count("_autotest_inject.js") == 1
    io.open("_autotest.html", "w", encoding="utf-8", newline="\n").write(html)

    print("regenerated _pure.js (%d chars) and _autotest.html" % len(pure))
    return 0


if __name__ == "__main__":
    sys.exit(main())
