"""Generate the Glean app icon from simple vector geometry, without dependencies."""
import math
import struct
import zlib
from pathlib import Path

SIZE = 512
SCALE = SIZE / 100
PALETTE = (35, 68, 48), (232, 240, 211)

def cubic(a, b, c, d):
    return [tuple((1-t)**3*a[j]+3*(1-t)**2*t*b[j]+3*(1-t)*t*t*c[j]+t**3*d[j] for j in (0, 1)) for t in [i/40 for i in range(41)]]

paths = [
    [(49, 77), (49, 40)],
    cubic((49, 57), (25, 57), (21, 37), (26, 24)) + cubic((26, 24), (44, 26), (55, 38), (49, 57)),
    cubic((49, 44), (69, 46), (80, 28), (72, 16)) + cubic((72, 16), (55, 20), (46, 29), (49, 44)),
    [(34, 36), (49, 57)], [(65, 28), (49, 44)],
]
segments = [(a, b) for path in paths for a, b in zip(path, path[1:])]

def line_distance(x, y, a, b):
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = max(0, min(1, ((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy or 1)))
    return math.hypot(x-a[0]-t*dx, y-a[1]-t*dy)

def chunk(kind, data):
    return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data)&0xffffffff)

pixels = bytearray()
for row in range(SIZE):
    pixels.append(0)
    for col in range(SIZE):
        x, y = (col+.5)/SCALE, (row+.5)/SCALE
        qx, qy = abs(x-50)-29, abs(y-50)-29
        distance = math.hypot(max(qx,0),max(qy,0))+min(max(qx,qy),0)-16
        alpha = int(max(0, min(1, .5-distance*SCALE))*255)
        ink_distance = min(line_distance(x,y,a,b) for a,b in segments) if 19<x<82 and 10<y<84 else 100
        ink = max(0, min(1, .5+(1.1-ink_distance)*SCALE))
        rgb = [round(a*(1-ink)+b*ink) for a,b in zip(*PALETTE)]
        pixels.extend([*rgb, alpha])
png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',SIZE,SIZE,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(pixels)))+chunk(b'IEND',b'')
root = Path(__file__).resolve().parents[1]/'desktop'
(root/'icon.png').write_bytes(png)
entry = b'ic09'+struct.pack('>I',len(png)+8)+png
(root/'icon.icns').write_bytes(b'icns'+struct.pack('>I',len(entry)+8)+entry)
print('Generated desktop/icon.png and desktop/icon.icns')
