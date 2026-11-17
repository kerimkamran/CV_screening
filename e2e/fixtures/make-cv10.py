# Makes e2e/fixtures/cv-10p.pdf: an invented ten-page CV (no real person) for the performance cases.
# python3 make-cv10.py  (needs reportlab)
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

W, H = A4
c = canvas.Canvas('cv-10p.pdf', pagesize=A4)
for n in range(1, 11):
    c.setFillColor(HexColor('#0f4c5c')); c.rect(0, H - 70, W, 70, fill=1, stroke=0)
    c.setFillColor(HexColor('#ffffff')); c.setFont('Helvetica-Bold', 20)
    c.drawString(40, H - 45, f'Rauf Aliyev - invented CV, page {n} of 10')
    c.setFillColor(HexColor('#1a1a1a')); c.setFont('Helvetica', 10)
    y = H - 110
    for i in range(1, 46):
        c.drawString(40, y, f'{n}.{i} Designed and ran carrier IP routing: BGP, OSPF, IS-IS and MPLS on a national backbone.')
        y -= 15
    c.showPage()
c.save()
