"""Writes the small real-world and hostile ZIP fixtures for zip-spool.integration.spec.ts (S3-UP-06).
Run once with python3; the outputs are committed. Each is under 5 KB. Every person is invented.
"""
import io, subprocess, os, zipfile, struct

def cv(name, line):
    return f"Name: {name}\n{line}\n" + "Padding text for length. " * 10

# macOS Finder: a folder entry, __MACOSX resource forks and .DS_Store litter, UTF-8 names.
with zipfile.ZipFile('finder.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('CVs/', '')
    z.writestr('CVs/Aysel_Huseynova.txt', cv('Aysel Huseynova', 'BGP routing.'))
    z.writestr('CVs/Rəşad_Quliyev.txt', cv('Rashad Quliyev', 'Kubernetes.'))
    z.writestr('__MACOSX/CVs/._Aysel_Huseynova.txt', b'\x00\x05\x16\x07')
    z.writestr('CVs/.DS_Store', b'\x00\x00\x00\x01Bud1')

# Windows Explorer: CP437 names (no UTF-8 flag), backslash in a name, a Thumbs.db.
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr(zipfile.ZipInfo('CVs\\Elchin_Mammadov.txt'), cv('Elchin Mammadov', 'BGP routing.'))
    z.writestr(zipfile.ZipInfo('CVs\\Leyla_Aliyeva.txt'), cv('Leyla Aliyeva', 'Kubernetes.'))
    z.writestr(zipfile.ZipInfo('CVs\\Thumbs.db'), b'litter')
open('windows.zip', 'wb').write(buf.getvalue())

# 7-Zip style: stored and deflated entries mixed, an extra-field timestamp.
with zipfile.ZipFile('sevenzip.zip', 'w') as z:
    z.writestr(zipfile.ZipInfo('Farid_Huseynli.txt'), cv('Farid Huseynli', 'BGP routing.'), zipfile.ZIP_STORED)
    z.writestr(zipfile.ZipInfo('Nigar_Rzayeva.md'), cv('Nigar Rzayeva', 'Kubernetes.'), zipfile.ZIP_DEFLATED)

# Written as a stream: sizes in data descriptors after each entry (general-purpose bit 3).
class Unseekable(io.RawIOBase):
    def __init__(self): self.b = bytearray()
    def writable(self): return True
    def write(self, d): self.b += d; return len(d)
s = Unseekable()
with zipfile.ZipFile(s, 'w', zipfile.ZIP_DEFLATED) as z:
    with z.open('Stream_One.txt', 'w') as f: f.write(cv('Stream One', 'BGP routing.').encode())
    with z.open('Stream_Two.txt', 'w') as f: f.write(cv('Stream Two', 'Kubernetes.').encode())
open('streamed.zip', 'wb').write(bytes(s.b))

# Password-protected (ZipCrypto) with the zip command.
open('/tmp/Secret_Person.txt', 'w').write(cv('Secret Person', 'BGP routing.'))
if os.path.exists('password.zip'): os.remove('password.zip')
subprocess.run(['zip', '-q', '-j', '-P', 'secret', 'password.zip', '/tmp/Secret_Person.txt'], check=True)

# "PK" but not really a ZIP.
open('pk-not-really.zip', 'wb').write(b'PK\x03\x04' + b'not a zip at all, just text' * 4)

for n in sorted(os.listdir('.')):
    if n.endswith('.zip'): print(n, os.path.getsize(n))
