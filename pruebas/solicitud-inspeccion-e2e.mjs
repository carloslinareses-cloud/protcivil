import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chromium} from 'file:///C:/Users/carlo/node_modules/playwright/index.mjs';
import {initializeApp,cert,deleteApp} from 'firebase-admin/app';
import {getDatabase} from 'firebase-admin/database';
import {getAuth} from 'firebase-admin/auth';
import {CAMPOS,FAMILIA,validar} from '../solicitud-inspeccion-data.mjs';
const raiz=path.resolve(import.meta.dirname,'..'),produccion=process.argv.includes('--produccion'),salida=path.join(raiz,'output/solicitud-inspeccion');fs.mkdirSync(salida,{recursive:true});
const cred='C:/Users/carlo/Documents/Alcaldia BDD/',app=initializeApp({credential:cert(JSON.parse(fs.readFileSync(cred+fs.readdirSync(cred).find(n=>/^alcaldia-admin-firebase-adminsdk-.*\.json$/.test(n)),'utf8'))),databaseURL:'https://alcaldia-admin-default-rtdb.firebaseio.com'}),db=getDatabase(app),auth=getAuth(app);
const marca='ZZ PRUEBA FICTICIA INSPECCION '+Date.now(),datos={};
for(const c of CAMPOS)datos[c.clave]=c.tipo==='fijo'?c.valor:c.tipo==='edad'?35:c.tipo==='cantidad'?0:c.tipo==='parroquia'?'Charallave':c.tipo==='tipo'?'Casa':c.tipo==='cedula'?'V-99999999':c.tipo==='tel'?'00000000000':c.tipo==='textarea'?'Descripción ficticia para comprobar la solicitud, con tildes y texto completo.':c.etiqueta+' de prueba';
datos.solicitante_nombre=marca;datos.diagnostico+=' <img src=x onerror=alert(1)> Texto que debe mostrarse como datos.';
datos.familia=[{parentesco:'Hijo',nombre:'FAMILIAR FICTICIO',edad:0,sexo:'Masculino',plantel:'No aplica'},{parentesco:'Hermana',nombre:'FAMILIAR DE PRUEBA',edad:25,sexo:'Femenino',cedula:'V-99999998',plantel:'PLANTEL FICTICIO'}];
assert.equal(validar(datos),'');assert(validar({...datos,solicitante_edad:-1}));assert(validar({...datos,tipo_inspeccion:'Árbol'}));
const temporales=new Set();let id,browser;
const tipos={'.html':'text/html','.mjs':'application/javascript','.js':'application/javascript','.css':'text/css','.png':'image/png'};
const servidor=http.createServer((req,res)=>{const f=path.resolve(raiz,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(raiz+path.sep))return res.writeHead(403).end();try{res.setHeader('Content-Type',tipos[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});
await new Promise(r=>servidor.listen(0,'127.0.0.1',r));const base=produccion?'https://protcivil.alcaldiadecharallave.com':'http://127.0.0.1:'+servidor.address().port;
const menuAntes=fs.readFileSync(path.join(raiz,'reportar-riesgo.html'),'utf8');assert(!menuAntes.includes('solicitud-inspeccion'));
async function descargar(page,selector,nombre){const ev=page.waitForEvent('download');await page.click(selector);const d=await ev;await d.saveAs(path.join(salida,nombre));}
try{
 for(const f of ['solicitud-inspeccion-data.mjs','solicitud-inspeccion.mjs','solicitud-inspeccion-resultados.mjs']){const r=spawnSync(process.execPath,['--check',path.join(raiz,f)],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,f+': '+r.stderr);}
 browser=await chromium.launch({channel:'chrome',headless:true});const ctx=await browser.newContext({permissions:['clipboard-read','clipboard-write']}),page=await ctx.newPage(),errores=[];page.on('pageerror',e=>errores.push(e.message));
 await page.setViewportSize({width:375,height:900});await page.goto(base+'/solicitud-inspeccion.html');await page.locator('#solicitante_nombre').waitFor();assert.equal(await page.locator('a[href="reportar-riesgo.html"]').count(),0);
 await page.evaluate(d=>{for(const [k,v] of Object.entries(d)){const e=document.getElementById(k);if(e)e.value=v;}document.getElementById('tipo_inspeccion').dispatchEvent(new Event('change'));},datos);
 assert(await page.locator('#nucleo').isVisible());for(const persona of datos.familia){await page.click('#agregar');await page.locator('#familia fieldset').last().evaluate((fs,p)=>{for(const [k,v]of Object.entries(p))fs.querySelector(`[data-campo="${k}"]`).value=v;},persona);}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('input,select').evaluateAll(xs=>xs.filter(e=>!e.disabled).every(e=>e.getBoundingClientRect().height>=44)));
 await page.screenshot({path:path.join(salida,produccion?'publico-produccion-movil.png':'publico-movil.png'),fullPage:true});
 await page.click('#enviar');await page.waitForFunction(()=>!document.getElementById('confirmacion').hidden,{},{timeout:45000});id=await page.locator('#referencia').innerText();temporales.add(id);
 const guardado=(await db.ref('pc_solicitudes_inspeccion/'+id).get()).val();for(const c of CAMPOS)assert.equal(guardado[c.clave],datos[c.clave],c.clave);assert.deepEqual(guardado.familia,datos.familia);assert.equal(guardado.origen,'publico');
 const endpoint='https://alcaldia-admin-default-rtdb.firebaseio.com/pc_solicitudes_inspeccion';
 for(const p of ['', '/'+id])assert.equal((await fetch(endpoint+p+'.json')).status,401,'Lectura anónima rechazada');
 for(const method of ['PATCH','DELETE'])assert.equal((await fetch(endpoint+'/'+id+'.json',{method,...(method==='PATCH'?{body:JSON.stringify({diagnostico:'CAMBIO FICTICIO QUE DEBE RECHAZARSE'})}:{})})).status,401,'Cambio público rechazado');
 for(const cambio of [{campo_no_permitido:'x'},{estado:'Otro estado'},{familia:[{nombre:'FICTICIO SIN PARENTESCO'}]},{tipo_inspeccion:'Árbol',familia:datos.familia},{familia:Object.fromEntries(Array.from({length:51},(_,i)=>[i,datos.familia[0]]))}]){
  const prueba=db.ref('pc_solicitudes_inspeccion').push().key;temporales.add(prueba);const r=await fetch(endpoint+'/'+prueba+'.json',{method:'PUT',body:JSON.stringify({...guardado,...cambio,fecha_registro:Date.now()})});assert.equal(r.status,401,'Se rechaza un registro fuera del esquema');
 }
 const operadores=(await db.ref('pc_operadores').get()).val()||{},permitidos=Object.entries(operadores).filter(([,p])=>['admin_plus','admin'].includes(p.rol)&&!p.cambio_obligatorio);let operador;
 for(const [uid]of permitidos){const u=await auth.getUser(uid).catch(()=>null);if(u&&!u.disabled){operador=uid;break;}}assert(operador,'Debe existir una cuenta autorizada de Protección Civil');
 const token=await auth.createCustomToken(operador);await page.evaluate(async token=>{const {getAuth,signInWithCustomToken}=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');await signInWithCustomToken(getAuth(),token);},token);
 await page.goto(base+'/admin.html');await page.locator('a.card[href="solicitud-inspeccion-resultados.html"]').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('r_solicitudes_inspeccion_total')?.textContent==='1');
 await page.click('a.card[href="solicitud-inspeccion-resultados.html"]');await page.locator('#contenido').waitFor({state:'visible'});await page.waitForFunction(()=>document.getElementById('cantidad').textContent.includes('solicitudes encontradas'));
 await page.fill('#buscar',marca);await page.locator('#filas button').click();assert.equal(await page.locator('#ficha img').count(),0);assert((await page.locator('#ficha').innerText()).includes(datos.diagnostico));
 for(const c of CAMPOS)assert((await page.locator('#ficha').innerText()).includes(String(datos[c.clave])),c.clave);
 for(const p of datos.familia)assert((await page.locator('#ficha').innerText()).includes(p.nombre));
 await page.click('#copiar');assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://protcivil.alcaldiadecharallave.com/solicitud-inspeccion.html');
 await descargar(page,'#descargarQR',produccion?'qr-produccion.png':'qr.png');await descargar(page,'#excel',produccion?'solicitudes-produccion.xlsx':'solicitudes.xlsx');await descargar(page,'#pdfFicha',produccion?'solicitud-produccion.pdf':'solicitud.pdf');
 await page.locator('#cerrarDetalle').click();await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(salida,'panel-escritorio.png'),fullPage:true});await page.setViewportSize({width:375,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(salida,'panel-movil.png'),fullPage:true});
 assert.equal(await page.locator('#imagenQR').evaluate(e=>e.complete&&e.naturalWidth>0),true);assert.deepEqual(errores,[]);
 await page.evaluate(async()=>{const{getAuth,signOut}=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js');await signOut(getAuth());});
 assert.equal(fs.readFileSync(path.join(raiz,'reportar-riesgo.html'),'utf8'),menuAntes);
 console.log(JSON.stringify({modo:produccion?'produccion':'localConBackendReal',campos:CAMPOS.length,familiares:2,guardadoCompleto:true,lecturaPublicaBloqueada:true,cambiosPublicosBloqueados:true,validacionServidor:true,admin:true,qrEnlaceExcelPDF:true,movilSinDesborde:true,menuPublicoSinCambios:true,errores}));
}catch(e){console.error('Fallo de verificación: '+e.message);process.exitCode=1;}
finally{await browser?.close();const restantes=(await db.ref('pc_solicitudes_inspeccion').get()).val()||{};for(const [key,r]of Object.entries(restantes))if(r.solicitante_nombre===marca)temporales.add(key);for(const key of temporales)await db.ref('pc_solicitudes_inspeccion/'+key).remove();servidor.close();await deleteApp(app);}
