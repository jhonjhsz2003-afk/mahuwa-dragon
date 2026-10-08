import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sharp=process.env.SD_NODE_MODULES?require(resolve(process.env.SD_NODE_MODULES,'sharp')):require('sharp');
const assets=resolve(root,'web/assets');await mkdir(resolve(assets,'sample'),{recursive:true});
const logo=await readFile(resolve(assets,'dragon-logo.svg'));
for(const size of [32,192,512])await sharp(logo).resize(size,size).png().toFile(resolve(assets,`icon${size}.png`));
const escape=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const dialogue=[
 ['WELCOME TO THE DRAGON LIBRARY.','EVERY STORY OPENS A NEW WORLD.','ARE YOU READY FOR AN ADVENTURE?','LET THE FIRST CHAPTER BEGIN!'],
 ['THE LITTLE DRAGON NEEDS OUR HELP.','ITS STORY HAS LOST THE FINAL PAGE.','WE MUST FIND THE HIDDEN DOOR.','FOLLOW THE LIGHT BETWEEN THE BOOKS.'],
 ['COURAGE CAN BEGIN AS A SMALL FLAME.','KEEP READING AND IT WILL GROW.','THANK YOU FOR JOINING OUR JOURNEY!','YOUR NEXT ADVENTURE IS WAITING.']
];
for(let index=0;index<3;index++) {
 const lines=dialogue[index];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500"><defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#171529"/><stop offset="1" stop-color="#224359"/></linearGradient><linearGradient id="light"><stop stop-color="#68ebc6"/><stop offset="1" stop-color="#ae8afa"/></linearGradient></defs><rect width="1000" height="1500" fill="#eef0f6"/><rect x="24" y="24" width="952" height="1452" rx="12" fill="url(#sky)" stroke="#111" stroke-width="5"/><path d="M45 960 290 670 465 770 670 530 956 700V1460H45Z" fill="#151523"/><path d="M48 1150 310 900 520 1100 760 740 955 1060V1460H48Z" fill="#31334c"/><path d="m370 820 40-160 85 88 78-180 48 141 100-29-36 100 75 57-86 110-101-30-50 144-92-64-96 38 44-152Z" fill="url(#light)" opacity=".93"/><path d="m581 789 68 31-58 35Z" fill="#171522"/><ellipse cx="500" cy="255" rx="438" ry="180" fill="white" stroke="#111" stroke-width="5"/><ellipse cx="500" cy="1200" rx="438" ry="180" fill="white" stroke="#111" stroke-width="5"/><g fill="#12121c" font-family="Arial,sans-serif" font-weight="bold" font-size="33" text-anchor="middle"><text x="500" y="235">${escape(lines[0])}</text><text x="500" y="285">${escape(lines[1])}</text><text x="500" y="1180">${escape(lines[2])}</text><text x="500" y="1230">${escape(lines[3])}</text></g><text x="70" y="1430" fill="#b3bad1" font-family="Arial" font-size="20">MAHUWA DRAGON · HISTÓRIA ORIGINAL · ${index+1}/3</text></svg>`;
 await sharp(Buffer.from(svg)).png().toFile(resolve(assets,`sample/page-${index+1}.png`));
}
for(const [name,title,subtitle] of [['cover','A BIBLIOTECA','DO DRAGÃO'],['novel-cover','CRÔNICAS','DE UMA CHAMA']]) {
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="920"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#161927"/><stop offset="1" stop-color="#354963"/></linearGradient></defs><rect width="640" height="920" fill="url(#g)"/><path d="m180 560 20-170 70 70 60-160 40 130 90-40-36 100 72 50-77 90-80-26-32 110-70-46-70 30 31-120Z" fill="#8aebca"/><path d="m344 480 58 22-50 31Z" fill="#252c43"/><path d="M0 780 130 670 280 735 380 635 640 760V920H0Z" fill="#161b29"/><g font-family="Arial,sans-serif" font-weight="bold" text-anchor="middle"><text x="320" y="135" fill="#adf4d9" font-size="20" letter-spacing="4">ESTÚDIO DRAGON</text><text x="320" y="205" fill="#fff" font-size="37">${title}</text><text x="320" y="254" fill="#ddd3ff" font-size="37">${subtitle}</text><text x="320" y="854" fill="#9eb1c4" font-size="18">UMA HISTÓRIA ORIGINAL</text></g></svg>`;
 await sharp(Buffer.from(svg)).png().toFile(resolve(assets,`sample/${name}.png`));
}
console.log('Original sample pages, covers and icons generated.');
