#!/usr/bin/env python3
"""Convert solution paper markdown files to styled PDFs using weasyprint."""
import subprocess, sys, pathlib, textwrap

DOCS = pathlib.Path(__file__).parent
PAPERS = [
    ("solution_paper_task_a.md", "PERSONA_Task_A_Solution_Paper.pdf"),
    ("solution_paper_task_b.md", "PERSONA_Task_B_Solution_Paper.pdf"),
]

CSS = """
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=JetBrains+Mono&display=swap');

* { box-sizing: border-box; }

@page {
    size: A4;
    margin: 2.2cm 2.4cm 2.2cm 2.4cm;
    @bottom-center {
        content: counter(page) " / " counter(pages);
        font-family: 'Inter', sans-serif;
        font-size: 9pt;
        color: #94a3b8;
    }
}

body {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: #1e293b;
    max-width: 100%;
}

h1 {
    font-size: 17pt;
    font-weight: 700;
    color: #0f172a;
    border-bottom: 2.5px solid #6366f1;
    padding-bottom: 6pt;
    margin-top: 0;
    margin-bottom: 4pt;
    line-height: 1.3;
}

h2 {
    font-size: 13pt;
    font-weight: 700;
    color: #1e293b;
    margin-top: 22pt;
    margin-bottom: 6pt;
    border-left: 3px solid #6366f1;
    padding-left: 8pt;
}

h3 {
    font-size: 11pt;
    font-weight: 600;
    color: #334155;
    margin-top: 14pt;
    margin-bottom: 4pt;
}

/* Abstract styling */
h2:first-of-type + p, p:first-of-type {
    font-size: 10pt;
}

p { margin: 0 0 8pt 0; }

/* Bold subtitle line */
p > strong:only-child {
    display: block;
    color: #6366f1;
    font-size: 10pt;
    margin-bottom: 16pt;
}

code {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 8.5pt;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 3px;
    padding: 1px 4px;
    color: #374151;
}

pre {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 7.8pt;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 3px solid #6366f1;
    border-radius: 4px;
    padding: 10pt 12pt;
    overflow-x: auto;
    margin: 10pt 0;
    line-height: 1.5;
    white-space: pre;
}

pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: inherit;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin: 12pt 0;
    font-size: 9.5pt;
}

th {
    background: #1e293b;
    color: #f8fafc;
    font-weight: 600;
    padding: 6pt 10pt;
    text-align: left;
    font-size: 9pt;
}

td {
    padding: 5pt 10pt;
    border-bottom: 1px solid #e2e8f0;
    vertical-align: top;
}

tr:nth-child(even) td { background: #f8fafc; }
tr:last-child td { border-bottom: 2px solid #cbd5e1; }

/* Highlight PERSONA rows */
tr td:first-child strong { color: #6366f1; }

blockquote {
    margin: 10pt 0;
    padding: 8pt 14pt;
    border-left: 3px solid #f59e0b;
    background: #fffbeb;
    color: #78350f;
    font-style: italic;
    font-size: 9.5pt;
    border-radius: 0 4px 4px 0;
}

ul, ol {
    margin: 6pt 0;
    padding-left: 18pt;
}

li { margin-bottom: 3pt; }

hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 16pt 0;
}

/* Abstract box */
h2:contains("Abstract") + p {
    background: #f0f4ff;
    border: 1px solid #c7d2fe;
    border-radius: 6px;
    padding: 12pt 14pt;
    font-size: 10pt;
    color: #1e2a4a;
}

a { color: #6366f1; text-decoration: none; }
"""

def md_to_html(md_text: str, title: str) -> str:
    import markdown
    md = markdown.Markdown(extensions=["tables", "fenced_code", "toc"])
    body = md.convert(md_text)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>{CSS}</style>
</head>
<body>
{body}
</body>
</html>"""

def build(md_name: str, pdf_name: str):
    from weasyprint import HTML, CSS as WCSS
    md_path = DOCS / md_name
    pdf_path = DOCS / pdf_name
    html_path = DOCS / (pdf_name.replace(".pdf", ".html"))

    print(f"  Reading  {md_path.name} …")
    md_text = md_path.read_text(encoding="utf-8")

    title = md_text.splitlines()[0].lstrip("# ").strip()
    print(f"  Title    {title[:60]}")

    html = md_to_html(md_text, title)
    html_path.write_text(html, encoding="utf-8")
    print(f"  Wrote    {html_path.name}")

    print(f"  Rendering PDF …")
    HTML(filename=str(html_path)).write_pdf(str(pdf_path))
    size_kb = pdf_path.stat().st_size // 1024
    print(f"  Done     {pdf_path.name}  ({size_kb} KB)\n")
    html_path.unlink()   # clean up intermediate HTML

if __name__ == "__main__":
    try:
        import markdown
        from weasyprint import HTML
    except ImportError:
        print("Installing dependencies …")
        subprocess.check_call([sys.executable, "-m", "pip", "install",
                               "weasyprint", "markdown", "-q"])
        import markdown
        from weasyprint import HTML

    print("Building PDFs …\n")
    for md_name, pdf_name in PAPERS:
        build(md_name, pdf_name)

    print("All done.")
    for _, pdf_name in PAPERS:
        p = DOCS / pdf_name
        if p.exists():
            print(f"  ✓  {p}")
