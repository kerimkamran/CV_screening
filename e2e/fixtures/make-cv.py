# Makes e2e/fixtures/cv.pdf: an invented two-page CV (no real person) for the review-screen tests.
# python3 make-cv.py  (needs reportlab and DejaVu fonts)
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import glob
reg=glob.glob('/usr/share/fonts/**/DejaVuSans.ttf',recursive=True)[0]
bold=glob.glob('/usr/share/fonts/**/DejaVuSans-Bold.ttf',recursive=True)[0]
pdfmetrics.registerFont(TTFont('D',reg)); pdfmetrics.registerFont(TTFont('DB',bold))
W,H=A4
c=canvas.Canvas('cv.pdf',pagesize=A4)
teal=HexColor('#0f4c5c'); grey=HexColor('#555555'); light=HexColor('#e8f1f2')
# sidebar
c.setFillColor(teal); c.rect(0,0,190,H,fill=1,stroke=0)
c.setFillColor(HexColor('#ffffff')); c.circle(95,H-95,48,fill=1,stroke=0)
c.setFillColor(teal); c.setFont('DB',30); c.drawCentredString(95,H-106,'AM')
def side(y,title,items):
    c.setFillColor(HexColor('#ffffff')); c.setFont('DB',10.5); c.drawString(24,y,title.upper())
    c.setStrokeColor(HexColor('#7fb3bf')); c.line(24,y-5,166,y-5)
    c.setFont('D',8.8); y-=20
    for it in items:
        c.drawString(24,y,it); y-=13
    return y-12
y=H-180
y=side(y,'Contact',['+994 50 000 00 00','aysel@example.az','Bakı, Azərbaycan','linkedin.com/in/aysel'])
y=side(y,'Skills',['BGP, OSPF, IS-IS','MPLS / Segment Routing','Juniper, Cisco, Nokia','Python, Ansible','5G transport design','Network automation'])
y=side(y,'Languages',['Azərbaycan — native','English — C1','Русский — B2'])
y=side(y,'Certificates',['JNCIP-SP (2021)','CCNP Enterprise (2019)'])
# main
x=215
c.setFillColor(HexColor('#1a1a1a')); c.setFont('DB',26); c.drawString(x,H-80,'Aysel Məmmədova')
c.setFillColor(teal); c.setFont('D',12.5); c.drawString(x,H-100,'Senior Network Engineer · IP Core & Transport')
c.setFillColor(grey); c.setFont('D',9.2)
summ=['Ten years designing and running carrier IP networks. Led the BGP and OSPF',
'redesign of a national mobile backbone and the 5G transport rollout across',
'three regions. Team lead for four engineers since 2022.']
yy=H-125
for l in summ: c.drawString(x,yy,l); yy-=13
def section(y,title):
    c.setFillColor(teal); c.setFont('DB',11.5); c.drawString(x,y,title.upper())
    c.setStrokeColor(teal); c.setLineWidth(1.2); c.line(x,y-5,W-40,y-5); return y-24
def job(y,role,org,dates,bullets):
    c.setFillColor(HexColor('#1a1a1a')); c.setFont('DB',10.5); c.drawString(x,y,role)
    c.setFillColor(grey); c.setFont('D',9); c.drawRightString(W-40,y,dates)
    c.setFillColor(teal); c.setFont('D',9.5); c.drawString(x,y-13,org)
    c.setFillColor(HexColor('#333333')); c.setFont('D',9); y-=30
    for b in bullets:
        c.drawString(x+4,y,'•'); c.drawString(x+14,y,b); y-=12.5
    return y-10
y=section(yy-14,'Experience')
y=job(y,'Network Design Lead','National mobile operator, Bakı','2019 – now',
 ['Redesigned the IP core with BGP route reflectors and OSPF areas.','Led 5G transport: segment routing over MPLS, 1,200 sites.','Automated changes with Python and Ansible; outages down 40 %.','Team lead for four engineers; hiring and mentoring.'])
y=job(y,'Senior Network Engineer','Regional ISP, Sumqayıt','2016 – 2019',
 ['Ran the BGP edge with 14 upstream and peering partners.','Migrated the access network to IS-IS and MPLS L3VPN.'])
y=job(y,'Network Engineer','Telecom integrator, Bakı','2014 – 2016',
 ['Configured Cisco and Juniper routers for enterprise customers.'])
y=section(y,'Education')
c.setFillColor(HexColor('#1a1a1a')); c.setFont('DB',10.5); c.drawString(x,y,'BSc Computer Engineering')
c.setFillColor(grey); c.setFont('D',9); c.drawRightString(W-40,y,'2010 – 2014')
c.setFillColor(teal); c.setFont('D',9.5); c.drawString(x,y-13,'ADA University, Bakı')
c.showPage()
# page 2
c.setFillColor(teal); c.rect(0,0,190,H,fill=1,stroke=0)
y=section(H-70,'Projects')
y=job(y,'5G transport rollout','Program lead','2021 – 2023',['Three regions, 1,200 sites; segment routing; on time and on budget.'])
y=job(y,'Backbone BGP redesign','Architect','2019 – 2020',['Route reflectors, communities and RPKI; convergence under 2 s.'])
y=section(y,'Training')
c.setFillColor(HexColor('#333333')); c.setFont('D',9)
for l in ['Juniper Service Provider Routing (JNCIP-SP) — 2021','Python for network engineers — 2020','Leading technical teams — 2022']:
    c.drawString(x,y,l); y-=13
c.save()
