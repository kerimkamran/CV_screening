# Makes the binary fixtures of the UAT plan (section 9) into e2e/fixtures/files/. All people are
# invented. Run: python3 e2e/fixtures/make-files.py  (needs python-docx, reportlab and qpdf)
import io
import os
import subprocess
import zipfile

from docx import Document
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'files')
os.makedirs(OUT, exist_ok=True)
pdfmetrics.registerFont(TTFont('D', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))

# 1. A Word CV (pages are made by LibreOffice on the server).
d = Document()
d.add_heading('Rəşad Əliyev', 0)
d.add_paragraph('Senior Network Engineer · Bakı · rashad.example@example.az')
d.add_heading('Experience', level=1)
d.add_paragraph('Network Design Lead, national operator, 2019 to now.')
d.add_paragraph('Designed BGP route reflectors and OSPF areas for the carrier core.', style='List Bullet')
d.add_paragraph('Ran Kubernetes in production for the network automation platform.', style='List Bullet')
d.add_paragraph('Python scripting for network automation with Ansible.', style='List Bullet')
d.add_heading('Education', level=1)
d.add_paragraph('BSc Computer Engineering, ADA University, 2014.')
d.save(os.path.join(OUT, 'rashad.docx'))

# 2. A "dense skills" PDF: eight quoted lines within 2 % of the page height (evidence-dot spill).
c = canvas.Canvas(os.path.join(OUT, 'dense-skills.pdf'), pagesize=A4)
W, H = A4
c.setFont('D', 16)
c.drawString(60, H - 70, 'Dense Skills Person')
c.setFont('D', 6)
skills = ['BGP routing', 'OSPF areas', 'Kubernetes clusters', 'Python scripting', 'MPLS core',
          'Segment routing', 'Ansible automation', 'IS-IS design']
y0 = H - 140
for i, s in enumerate(skills):
    c.drawString(60, y0 - i * 2, f'{s} in production since 2018.')  # 2 pt apart: 14 pt for 8 lines
c.setFont('D', 10)
c.drawString(60, H - 300, 'Education: BSc Computer Engineering.')
c.showPage()
c.save()

# 3. A password-protected PDF and a broken PDF.
plain = os.path.join(OUT, 'plain-for-lock.pdf')
c = canvas.Canvas(plain, pagesize=A4)
c.setFont('D', 12)
c.drawString(60, H - 80, 'Locked Person · BGP routing · Kubernetes')
c.showPage()
c.save()
subprocess.run(['qpdf', '--encrypt', 'user-pass', 'owner-pass', '256', '--', plain,
                os.path.join(OUT, 'protected.pdf')], check=True)
os.remove(plain)
with open(os.path.join(HERE, 'cv.pdf'), 'rb') as f:
    good = f.read()
with open(os.path.join(OUT, 'broken.pdf'), 'wb') as f:
    f.write(good[: len(good) // 3])  # cut off: no cross-reference table, no end
with open(os.path.join(OUT, 'not-a-pdf.pdf'), 'wb') as f:
    f.write(b'This is plain text with a .pdf name.\n' * 20)

# 4. ZIPs: a good ZIP of CVs, an over-size ZIP, and a ZIP with too many entries.
def cv_text(name, lines):
    return f'Name: {name}\n' + '\n'.join(lines) + '\n' + 'Padding text for length. ' * 10

with zipfile.ZipFile(os.path.join(OUT, 'cvs.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('zip-anna.txt', cv_text('Anna Zip', ['BGP routing at a carrier.', 'Kubernetes in production.']))
    z.writestr('zip-bob.txt', cv_text('Bob Zip', ['Python scripting.']))
    z.writestr('folder/zip-cara.txt', cv_text('Cara Zip', ['OSPF and BGP routing.']))
    z.writestr('photo.jpg', b'\xff\xd8\xff\xe0not really a photo')

# Over-size: about 11 MB of incompressible data (over the 10 MB per-file limit when sent as one file).
with zipfile.ZipFile(os.path.join(OUT, 'oversize.zip'), 'w', zipfile.ZIP_STORED) as z:
    z.writestr('big.txt', os.urandom(11 * 1024 * 1024))

# Too many entries: 600 tiny CVs (over the 500 per vacancy).
with zipfile.ZipFile(os.path.join(OUT, 'too-many.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for i in range(600):
        z.writestr(f'cv-{i:03}.txt', cv_text(f'Many Person {i}', ['BGP routing.']))

print('fixtures written to', OUT)
