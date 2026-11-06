"""Union expanded glyph strokes before extrusion, preserving closed counters."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops, ImageFilter

path = Path(__file__).resolve().parent.parent / 'assets/ui/intro-glyphs.json'
data = json.loads(path.read_text(encoding='utf-8-sig'))
scale, size = 400, 480
def simplify(points, epsilon=.8):
    if len(points)<3: return points
    ax,ay=points[0]; bx,by=points[-1]
    dx,dy=bx-ax,by-ay
    length=(dx*dx+dy*dy)**.5
    distances=[abs(dx*(ay-y)-(ax-x)*dy)/length if length else ((x-ax)**2+(y-ay)**2)**.5 for x,y in points]
    index=max(range(len(points)),key=lambda i:distances[i])
    if distances[index]<=epsilon: return [points[0],points[-1]]
    return simplify(points[:index+1],epsilon)[:-1]+simplify(points[index:],epsilon)
for glyph in data.values():
    mask=Image.new('1',(size,size))
    for contour in glyph['contours']:
        part=Image.new('1',(size,size))
        ImageDraw.Draw(part).polygon([(round(x*scale+size/2),round(-y*scale+size/2)) for x,y in contour],fill=1)
        mask=ImageChops.logical_xor(mask,part)
    mask=mask.convert('L').filter(ImageFilter.MaxFilter(17))
    pixels=mask.load(); edges={}
    def edge(a,b): edges.setdefault(a,[]).append(b)
    for y in range(1,size-1):
        for x in range(1,size-1):
            if not pixels[x,y]: continue
            if not pixels[x,y-1]: edge((x,y),(x+1,y))
            if not pixels[x+1,y]: edge((x+1,y),(x+1,y+1))
            if not pixels[x,y+1]: edge((x+1,y+1),(x,y+1))
            if not pixels[x-1,y]: edge((x,y+1),(x,y))
    contours=[]
    while edges:
        first=next(iter(edges)); current=first; loop=[first]
        while True:
            following=edges[current].pop()
            if not edges[current]: del edges[current]
            current=following; loop.append(current)
            if current==first: break
        simple=simplify(loop)
        if len(simple)>3: contours.append([[round((x-size/2)/scale,5),round(-(y-size/2)/scale,5)] for x,y in simple[:-1]])
    glyph['contours']=contours
path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Bold outline unions saved:',path)
