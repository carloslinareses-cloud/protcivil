/* Recorre el formulario y administrador reales. Crea únicamente registros y usuario temporales, retirados al finalizar. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {initializeApp,cert} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
import {getAuth} from 'firebase-admin/auth';
import puppeteer from 'puppeteer-core';
const carpeta=path.resolve(import.meta.dirname,'..'),sal=fs.mkdtempSync(path.join(os.tmpdir(),'pc-educacion-'));
const {CAMPOS,SUMAS,validar}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(carpeta,'educacion-data.js'),'utf8')).toString('base64'));
initializeApp({credential:cert(JSON.parse(fs.readFileSync('C:/Users/carlo/Documents/Alcaldia BDD/alcaldia-admin-firebase-adminsdk-fbsvc-207472a5bd.json','utf8'))),databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com'});
const db=getDatabase(),auth=getAuth(),uid='prueba-educacion-'+Date.now(),marca='ZZ PRUEBA EDUCACIÓN '+Date.now();let id=null,navegador=null;
const datos={};for(const c of CAMPOS)datos[c.clave]=['number','edad'].includes(c.tipo)?(c.tipo==='edad'?45:12):c.tipo==='total'?24:c.tipo==='si_no'?'Sí':c.tipo==='parroquia'?'Charallave':c.tipo==='cedula'?'V-99999999':c.tipo==='tel'?'00000000000':c.tipo==='textarea'?'Contenido de prueba con acentos: educación, niños y reseña.':c.etiqueta+' de prueba';datos.plantel=marca;for(const [t,a,b] of SUMAS)datos[t]=datos[a]+datos[b];assert.equal(validar(datos),'');
assert.ok(validar({...datos,estudiantes_ninos:-1}));assert.ok(validar({...datos,estudiantes_total:99}));assert.ok(validar({...datos,director_edad:121}));
const tipos={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png'};
const servidor=http.createServer((req,res)=>{const f=path.resolve(carpeta,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(carpeta+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',tipos[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch(e){res.writeHead(404).end();}});
await new Promise(ok=>servidor.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+servidor.address().port;
async function esperarArchivo(ext){for(let i=0;i<80;i++){const f=fs.readdirSync(sal).find(f=>f.endsWith(ext));if(f)return path.join(sal,f);await new Promise(ok=>setTimeout(ok,200));}throw Error('No se descargó '+ext);}
try{
 const url='https://alcaldia-admin-default-rtdb.firebaseio.com/pc_educacion.json';const anon=await fetch(url);assert.equal(anon.status,401,'Los registros no pueden leerse públicamente');
 const invalido=await fetch(url.replace('.json','/'+db.ref('pc_educacion').push().key+'.json'),{method:'PUT',body:JSON.stringify({plantel:'Inválido'})});assert.equal(invalido.status,401,'El servidor rechaza registros incompletos');
 navegador=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await navegador.newPage(),errores=[];page.on('pageerror',e=>errores.push(e.message));page.on('dialog',async d=>{throw Error('Diálogo inesperado: '+d.message());});
 await page.setViewport({width:375,height:900});await page.goto(base+'/reportar-riesgo.html',{waitUntil:'networkidle2'});assert.ok(await page.$('#irEducacion'));await page.click('#irEducacion');await page.waitForSelector('#plantel');
 await page.evaluate(d=>{for(const [k,v] of Object.entries(d)){const el=document.getElementById(k);if(!el.readOnly)el.value=v;}document.getElementById('plantel').dispatchEvent(new Event('input',{bubbles:true}));},datos);
 assert.equal(await page.$eval('#estudiantes_total',e=>e.value),'24');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(sal,'formulario-movil.png'),fullPage:true});
 await page.click('#enviar');await page.waitForFunction(()=>!document.getElementById('confirmacion').hidden,{timeout:20000});
 const s=await db.ref('pc_educacion').once('value');id=Object.keys(s.val()||{}).find(k=>s.val()[k].plantel===marca);assert.ok(id,'Registro público guardado');for(const [k,v] of Object.entries(datos))assert.equal(s.val()[id][k],v,'Campo '+k);
 await auth.createUser({uid,email:uid+'@alcaldia.com',password:'Temporal-'+crypto.randomUUID()});await db.ref('pc_operadores/'+uid).set({nombre:'Prueba automatizada de educación',rol:'admin_plus',cambio_obligatorio:false});const token=await auth.createCustomToken(uid);
 await page.evaluate(async token=>{const {getAuth,signInWithCustomToken}=await import('https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js');await signInWithCustomToken(getAuth(),token);},token);
 await page.goto(base+'/admin.html',{waitUntil:'networkidle2'});await page.waitForSelector('#r_educacion_total');await page.waitForFunction(()=>document.getElementById('r_educacion_total').textContent!=='–');assert.ok(await page.$('a[href="educacion-resultados.html"]'));
 await page.goto(base+'/educacion-resultados.html',{waitUntil:'networkidle2'});await page.waitForFunction(()=>!document.getElementById('contenido').hidden);await page.type('#buscar',marca);await page.waitForFunction(()=>document.querySelector('#filas button'));await page.click('#filas button');await page.waitForFunction(()=>!document.getElementById('detalle').hidden);assert.equal(await page.$$eval('#ficha dd',es=>es.length),CAMPOS.length);await page.screenshot({path:path.join(sal,'admin-movil.png'),fullPage:true});
 const cdp=await page.createCDPSession();await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:sal});await page.click('#excel');const excel=await esperarArchivo('.xlsx');await page.click('#pdfFicha');const pdf=await esperarArchivo('.pdf');assert.ok(fs.statSync(pdf).size>10000);assert.ok(fs.statSync(excel).size>5000);
 await page.click('#editar');await page.waitForFunction(()=>!document.getElementById('enviar').disabled);assert.equal(await page.$eval('#resena',e=>e.value),datos.resena);await page.$eval('#resena',e=>e.value+=' Edición comprobada.');await page.click('#enviar');await page.waitForFunction(()=>location.pathname.endsWith('educacion-resultados.html'));assert.ok((await db.ref('pc_educacion/'+id+'/resena').once('value')).val().endsWith('Edición comprobada.'));
 await page.setViewport({width:1280,height:900});await page.goto(base+'/educacion.html',{waitUntil:'networkidle2'});await page.screenshot({path:path.join(sal,'formulario-escritorio.png'),fullPage:true});assert.deepEqual(errores,[]);
 console.log(JSON.stringify({resultado:'OK',campos:CAMPOS.length,guardado:true,admin:true,edicion:true,privacidad:true,exportaciones:[excel,pdf],capturas:sal}));
}finally{if(navegador)await navegador.close();if(id)await db.ref('pc_educacion/'+id).remove();await db.ref('pc_operadores/'+uid).remove();const b=(await db.ref('pc_bitacora').once('value')).val()||{};for(const [k,v] of Object.entries(b))if(v.uid===uid)await db.ref('pc_bitacora/'+k).remove();await auth.deleteUser(uid).catch(()=>{});servidor.close();}
process.exit(0);
