from pathlib import Path
import re
D=Path('handoff/designs')
p=D/'design.css';s=p.read_text().replace('repeat(8,63px)','repeat(16,31.5px)');s+='\n.admin .tag.amber{background:#fff3d6;color:#865000}.bottom{background:#fff}.dark .bottom{background:#172334}\n';p.write_text(s)
p=D/'after-schedule-desktop.html';s=p.read_text()
s=re.sub(r'(class="hour" style="grid-row:)(\d+)(")',lambda m:m[1]+str(2+(int(m[2])-2)*2)+m[3],s)
s=re.sub(r'(class="gcell" style="grid-row:)(\d+)(;grid-column:)',lambda m:m[1]+str(2+(int(m[2])-2)*2)+'/span 2'+m[3],s)
def fix(m):
 st,en=m[4],m[5];minutes=lambda t:int(t[:2])*60+int(t[3:]);row=2+(minutes(st)-540)//30;span=(minutes(en)-minutes(st))//30
 return m[1]+str(row)+'/span '+str(span)+m[3]+st+'–'+en
s=re.sub(r'(<div class="gevent[^"]*" style="grid-column:\d;grid-row:)(\d+/span \d+)("><strong>)(\d\d:\d\d)–(\d\d:\d\d)',fix,s)
s=s.replace('Grid layout shown schematically; production preserves exact time positioning.','All events keep their real start and end times.').replace('Specialisms · 3 sessions','3 parallel sessions')
p.write_text(s)
# Keep all admin destinations and lock access discoverable.
p=D/'after-admin.html';s=p.read_text();s=s.replace('>Data quality</a>','>Data & access</a>');s=s.replace('<a href="#" style="margin-top:auto">','<a href="#">Return visits</a><a href="#" style="margin-top:auto">');s=s.replace('Settings</a></aside>','Lock workspace</a></aside>');p.write_text(s)
