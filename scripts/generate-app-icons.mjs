/** Run from project root. Uses sharp, or TIMETABLE_ICON_SHARP_MODULE pointing to it. No network/fonts required. */
import fs from 'node:fs/promises';
import path from 'node:path';
const {default:sharp}=await import(process.env.TIMETABLE_ICON_SHARP_MODULE || 'sharp');
function svg(admin=false,small=false){
 const bg=admin?'#202940':'#3e51c7';
 const top=small?'<path d="M160 112v64m192-64v64" stroke="white" stroke-width="32" stroke-linecap="round"/>':'<path d="M176 112v56m160-56v56" stroke="white" stroke-width="24" stroke-linecap="round"/>';
 const marks=admin?'<rect x="154" y="304" width="48" height="64" rx="10" fill="#3e51c7"/><rect x="232" y="266" width="48" height="102" rx="10" fill="#3e51c7"/><rect x="310" y="228" width="48" height="140" rx="10" fill="#196c54"/>':small?'<path d="M160 264h64m64 0h64m-192 80h64m64 0h64" stroke="#3e51c7" stroke-width="36" stroke-linecap="round"/>':'<rect x="150" y="242" width="80" height="30" rx="8" fill="#3e51c7"/><rect x="246" y="242" width="114" height="30" rx="8" fill="#eef0ff"/><rect x="150" y="296" width="80" height="30" rx="8" fill="#eef0ff"/><rect x="246" y="296" width="114" height="30" rx="8" fill="#3e51c7"/><rect x="150" y="350" width="80" height="30" rx="8" fill="#3e51c7"/><rect x="246" y="350" width="114" height="30" rx="8" fill="#eef0ff"/>';
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>${admin?'Timetable Admin — calendar analytics':'My Timetable — scheduled sessions'}</title><rect width="512" height="512" fill="${bg}"/><rect x="112" y="144" width="288" height="264" rx="32" fill="white"/>${top}<path d="M112 208h288" stroke="${bg}" stroke-width="16"/>${marks}</svg>`;
}
function ico(buffers,sizes){let offset=6+16*buffers.length;const header=Buffer.alloc(offset);header.writeUInt16LE(1,2);header.writeUInt16LE(buffers.length,4);buffers.forEach((buf,i)=>{const j=6+i*16;header[j]=sizes[i];header[j+1]=sizes[i];header.writeUInt16LE(1,j+4);header.writeUInt16LE(32,j+6);header.writeUInt32LE(buf.length,j+8);header.writeUInt32LE(offset,j+12);offset+=buf.length;});return Buffer.concat([header,...buffers]);}
await fs.mkdir('branding',{recursive:true});
for(const admin of [false,true]){
 const dir=path.join('public',admin?'admin':'');await fs.mkdir(dir,{recursive:true});
 const master=svg(admin),fav=svg(admin,true);await fs.writeFile(path.join(dir,'app-icon.svg'),master);await fs.writeFile(path.join(dir,'favicon.svg'),fav);
 for(const [name,size] of [['icon-192.png',192],['icon-512.png',512],['icon-maskable-192.png',192],['icon-maskable-512.png',512],['apple-touch-icon.png',180]])await sharp(Buffer.from(master)).resize(size,size).png().toFile(path.join(dir,name));
 const buffers=[];for(const size of [16,32,48]){const buffer=await sharp(Buffer.from(fav)).resize(size,size).png().toBuffer();buffers.push(buffer);await fs.writeFile(path.join(dir,`favicon-${size}.png`),buffer);}
 await fs.writeFile(path.join(dir,'favicon.ico'),ico(buffers,[16,32,48]));
 await sharp(Buffer.from(master)).resize(1024,1024).png().toFile(path.join('branding',admin?'admin-icon-1024.png':'timetable-icon-1024.png'));
}
console.log('Generated both icon families: vector, SVG/ICO favicons, PNG 16/32/48, Apple 180, PWA and maskable 192/512, artwork 1024.');
