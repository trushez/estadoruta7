(function(){
"use strict";
var CATS=[
  {k:"ropa-f",n:"Ropa para Fernanda",t:"tallaF"},
  {k:"ropa-j",n:"Ropa para Jose",t:"tallaJ"},
  {k:"aseo",n:"Útiles de aseo"},
  {k:"alimentos",n:"Alimentos no perecibles"},
  {k:"hogar",n:"Cosas para la casa"},
  {k:"otro",n:"Otras cosas"}
];
var CATNAME={};CATS.forEach(function(c){CATNAME[c.k]=c.n});

var ss={
  get:function(k){try{return sessionStorage.getItem(k)}catch(e){return null}},
  set:function(k,v){try{sessionStorage.setItem(k,v)}catch(e){}},
  del:function(k){try{sessionStorage.removeItem(k)}catch(e){}}
};
var S=null, loadErr=false;
var pin=ss.get('fj-pin')||'';
var admin=!!pin;
var tab=ss.get('fj-tab')||'recibir';
var quien=ss.get('fj-quien')||'';
var openPledge=null,pinOpen=false,pinErr='',editId=null,confirmDel=null;
var inflight=0,lastErr='';
var queue=Promise.resolve();
var app=document.getElementById('app');

function h(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function faltan(it){return Math.max(0,it.necesitado-it.recibido-it.comprometido)}
function status(it){if(it.recibido>=it.necesitado)return'ok';if(faltan(it)===0)return'cubierto';return it.urgente?'urgente':'falta'}
function byId(id){for(var i=0;i<S.items.length;i++)if(S.items[i].id===id)return S.items[i];return null}
function fmtDate(iso,withTime){try{var d=new Date(iso);var s=d.toLocaleDateString('es-CL',{day:'numeric',month:'long'});if(withTime)s+=', '+d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit'});return s}catch(e){return''}}
function toast(msg){var t=document.getElementById('toast');t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(function(){t.hidden=true},4200)}
function talla(c){return c.t?(S.settings[c.t]||'').trim():''}
function pageLink(){return location.origin+location.pathname.replace(/index\.html$/,'')}

/* ---------- server ---------- */
function load(){
  var req=admin?fetch('/api/ayuda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin,op:'load'})}):fetch('/api/ayuda',{cache:'no-store'});
  return req.then(function(r){return r.json().then(function(j){return{status:r.status,j:j}})}).then(function(x){
    if(x.status===403){logout();toast('El PIN cambió. Vuelve a entrar.');return load()}
    if(!x.j.ok)throw new Error(x.j.error);
    S=x.j.state;loadErr=false;render();
  }).catch(function(){if(!S){loadErr=true;render()}});
}
function send(body){
  body.pin=pin;body.quien=quien;inflight++;lastErr='';render();
  queue=queue.then(function(){
    return fetch('/api/ayuda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(j){return{status:r.status,j:j}})})
      .then(function(x){
        inflight--;
        if(x.status===403){logout();toast('El PIN no es válido. Vuelve a entrar.');return load()}
        if(x.j.ok){if(!inflight)S=x.j.state;render()}
        else{lastErr='No se guardó el último cambio. Revisa y vuelve a intentar.';render();load()}
      })
      .catch(function(){inflight--;lastErr='Sin conexión. El último cambio no se guardó.';render();load()});
  });
}
function logout(){admin=false;pin='';ss.del('fj-pin');editId=null;confirmDel=null}

/* ---------- public view ---------- */
function itemRow(it,ctx){
  var st=status(it),f=faltan(it),need=Math.max(1,it.necesitado);
  var rp=Math.min(100,it.recibido/need*100),cp=Math.max(0,Math.min(100-rp,it.comprometido/need*100));
  var chip={urgente:'Urgente',falta:'Se necesita',cubierto:'Ya cubierto',ok:'Completo'}[st];
  var parts=[];
  if(f>0)parts.push('Faltan '+f+' de '+it.necesitado);
  else if(st==='cubierto')parts.push('Lo que falta ya viene en camino');
  if(it.recibido>0&&st!=='ok')parts.push(it.recibido+' recibido'+(it.recibido>1?'s':''));
  if(it.comprometido>0)parts.push(it.comprometido+' en camino');
  var key=ctx+':'+it.id;
  var out='<li class="item"><span class="name">'+h(it.nombre)+(it.nota?'<span class="note">'+h(it.nota)+'</span>':'')+'</span><span class="chip '+st+'">'+chip+'</span>'+
    '<div class="bar" aria-hidden="true"><i class="r" style="width:'+rp+'%"></i><i class="c" style="width:'+cp+'%"></i></div>'+
    '<div class="meta"><span>'+parts.join(' · ')+'</span>'+(f>0?'<button class="btn ghost small" data-act="pledge" data-key="'+h(key)+'" aria-expanded="'+(openPledge===key)+'">Yo lo llevo</button>':'')+'</div>';
  if(openPledge===key)out+=pledgeBox(it);
  return out+'</li>';
}
function pledgeBox(it){
  var s=S.settings,num=(s.whatsapp||'').replace(/\D/g,''),lugar=h(s.lugar||'la Oficina de Convivencia de la escuela'),hor=s.horario?' ('+h(s.horario)+')':'';
  if(num){
    var who=s.contacto?h(s.contacto):'quien coordina';
    var txt=encodeURIComponent('Hola, voy a llevar '+it.nombre+' para Fernanda y Jose.');
    return '<div class="pledge"><p>Gracias. Avísale a '+who+' para que lo anote y no llegue repetido:</p>'+
      '<a class="btn" href="https://wa.me/'+num+'?text='+txt+'" target="_blank" rel="noopener">Avisar por WhatsApp</a>'+
      '<p>Número: <span class="num">+'+h(num)+'</span></p><p>Después déjalo en '+lugar+hor+'.</p></div>';
  }
  return '<div class="pledge"><p>Gracias. Llévalo a '+lugar+hor+' y di que es para Fernanda y Jose. Las voluntarias lo anotan cuando llega y la lista se actualiza.</p></div>';
}
function publicHtml(){
  var s=S.settings,out='';
  out+='<header><p class="kicker">Donaciones · Incendio</p><h1>Ayuda para <em>Fernanda</em> y <em>Jose</em></h1>'+
    '<p class="lede">Fernanda y su hija Jose, de 5 años, perdieron su casa en un incendio y casi nada se salvó. Aquí está lo que todavía les falta, para que no lleguen cosas repetidas. La lista se actualiza cada vez que llega una donación.</p>'+
    '<div class="facts"><div class="fact"><h3>Dónde entregar</h3><p>'+h(s.lugar||'Oficina de Convivencia de la escuela')+'</p>'+(s.horario?'<small>'+h(s.horario)+'</small>':'')+'</div>'+
    '<div class="fact"><h3>Tallas de Fernanda</h3><p>'+(s.tallaF?h(s.tallaF):'Por confirmar')+'</p></div>'+
    '<div class="fact"><h3>Tallas de Jose</h3><p>'+(s.tallaJ?h(s.tallaJ):'Por confirmar')+'</p></div>'+
    '<div class="fact"><h3>Qué se recibe</h3><p>Solo cosas, no dinero</p><small>Ropa en buen estado, aseo y alimentos no perecibles</small></div></div></header>';
  var urg=S.items.filter(function(it){return it.urgente&&faltan(it)>0});
  if(urg.length)out+='<section class="urgent-band" aria-labelledby="h-urg"><h2 id="h-urg">Lo más urgente <span class="sub">'+urg.length+' cosa'+(urg.length>1?'s':'')+'</span></h2><ul class="list">'+urg.map(function(it){return itemRow(it,'u')}).join('')+'</ul></section>';
  CATS.forEach(function(c){
    var its=S.items.filter(function(it){return it.cat===c.k&&status(it)!=='ok'});
    if(!its.length)return;
    its.sort(function(a,b){return(b.urgente-a.urgente)||((faltan(b)>0)-(faltan(a)>0))});
    var t=talla(c);
    out+='<section class="cat" aria-labelledby="h-'+c.k+'"><h2 id="h-'+c.k+'">'+h(c.n)+(c.t?'<span class="sub">Talla: '+(t?h(t):'por confirmar')+'</span>':'')+'</h2><ul class="list">'+its.map(function(it){return itemRow(it,'c')}).join('')+'</ul></section>';
  });
  var done=S.items.filter(function(it){return status(it)==='ok'});
  if(done.length)out+='<details class="done"><summary>Ya está completo ('+done.length+'). No hace falta traer más de esto.</summary><ul>'+done.map(function(it){return'<li>'+h(it.nombre)+' · '+h(CATNAME[it.cat]||'')+'</li>'}).join('')+'</ul></details>';
  if(!S.items.length)out+='<section class="cat"><p class="hint">Todavía no hay cosas en la lista.</p></section>';
  out+='<footer><span>Lista actualizada el '+h(fmtDate(S.updated,true))+'.</span>';
  if(!admin){
    if(!pinOpen)out+='<button class="linkish" data-act="openpin">Acceso voluntarias</button>';
    else out+='<form class="pin" data-form="pin"><div><label for="pin">PIN de voluntarias</label><input id="pin" type="password" inputmode="numeric" autocomplete="off"></div><button class="btn" type="submit">Entrar</button>'+(pinErr?'<p class="err" style="flex-basis:100%">'+h(pinErr)+'</p>':'')+'</form>';
  }
  return out+'</footer>';
}

/* ---------- volunteer panel ---------- */
function stepper(id,field,val,label){
  return '<div class="grp">'+label+'<div class="stepper"><button data-act="step" data-id="'+id+'" data-f="'+field+'" data-d="-1" aria-label="Restar '+label+'">−</button><output>'+val+'</output><button data-act="step" data-id="'+id+'" data-f="'+field+'" data-d="1" aria-label="Sumar '+label+'">+</button></div></div>';
}
function catOptions(sel){return CATS.map(function(c){return'<option value="'+c.k+'"'+(c.k===sel?' selected':'')+'>'+h(c.n)+'</option>'}).join('')}
function tabRecibir(){
  var out='<p class="hint">Cuando llegue algo, toca <b>+</b> en "Llegó". Si alguien avisa que va a traer algo, súmalo en "En camino". Al marcar que llegó, se descuenta uno de "en camino" si había. Todo se guarda solo.</p>'+
    '<div style="max-width:360px"><label for="quien">Tu nombre (queda en el registro)</label><input id="quien" type="text" value="'+h(quien)+'" autocomplete="off"></div>';
  CATS.forEach(function(c){
    var its=S.items.filter(function(it){return it.cat===c.k});
    if(!its.length)return;
    out+='<div class="cathead">'+h(c.n)+'</div>';
    its.forEach(function(it){
      out+='<div class="ctl"><div class="name">'+h(it.nombre)+'<small>Se necesitan '+it.necesitado+' · faltan '+faltan(it)+'</small></div>'+
        stepper(it.id,'recibido',it.recibido,'Llegó')+stepper(it.id,'comprometido',it.comprometido,'En camino')+
        '<div class="row2"><button class="toggle" data-act="urg" data-id="'+it.id+'" aria-pressed="'+!!it.urgente+'">Urgente</button><button class="toggle" data-act="edit" data-id="'+it.id+'">Editar</button></div>';
      if(editId===it.id){
        out+='<form class="editbox" data-form="edit" data-id="'+it.id+'"><div class="full"><label for="e-nombre">Nombre</label><input id="e-nombre" name="nombre" type="text" value="'+h(it.nombre)+'" required></div>'+
          '<div><label for="e-cant">Cantidad que se necesita</label><input id="e-cant" name="necesitado" type="number" min="1" value="'+it.necesitado+'" required></div>'+
          '<div><label for="e-cat">Categoría</label><select id="e-cat" name="cat">'+catOptions(it.cat)+'</select></div>'+
          '<div class="full"><label for="e-nota">Nota (talla, detalle)</label><input id="e-nota" name="nota" type="text" value="'+h(it.nota)+'"></div>'+
          '<div class="actions"><button class="btn small" type="submit">Guardar</button><button class="btn ghost small" type="button" data-act="editcancel">Cancelar</button>'+
          (confirmDel===it.id?'<button class="btn danger small" type="button" data-act="delyes" data-id="'+it.id+'">Sí, quitar de la lista</button>':'<button class="btn ghost small" type="button" data-act="del" data-id="'+it.id+'">Quitar de la lista</button>')+'</div></form>';
      }
      out+='</div>';
    });
  });
  return out;
}
function tabAgregar(){
  return '<form class="formgrid" data-form="add"><div class="full"><label for="a-nombre">Qué se necesita</label><input id="a-nombre" name="nombre" type="text" required placeholder="Ej: Frazadas de 2 plazas"></div>'+
    '<div><label for="a-cant">Cantidad</label><input id="a-cant" name="necesitado" type="number" min="1" value="1" required></div>'+
    '<div><label for="a-cat">Categoría</label><select id="a-cat" name="cat">'+catOptions('hogar')+'</select></div>'+
    '<div class="full"><label for="a-nota">Nota (opcional)</label><input id="a-nota" name="nota" type="text" placeholder="Ej: talla 6, color oscuro"></div>'+
    '<label class="check full" for="a-urg"><input id="a-urg" name="urgente" type="checkbox"> Es urgente</label>'+
    '<div class="full"><button class="btn" type="submit">Agregar a la lista</button></div></form>';
}
function tabAfiche(){
  var share=!!(navigator.canShare&&window.File);
  return '<div class="flyer"><p class="hint">Imagen con lo que todavía falta, lista para mandar por WhatsApp. Se arma sola con la lista actual.</p>'+
    '<img id="flyer-img" alt="Afiche con las cosas que todavía faltan">'+
    '<div class="actions">'+(share?'<button class="btn" data-act="shareflyer">Compartir imagen</button>':'')+'<button class="btn'+(share?' ghost':'')+'" data-act="dlflyer">Descargar imagen</button><button class="btn ghost" data-act="copytxt">Copiar texto para WhatsApp</button></div>'+
    '<label for="wa-text">Texto para acompañar la imagen</label><textarea id="wa-text" readonly>'+h(waText())+'</textarea></div>';
}
function tabAjustes(){
  var s=S.settings;
  function f(id,label,val,ph,type){return'<div><label for="s-'+id+'">'+label+'</label><input id="s-'+id+'" name="'+id+'" type="'+(type||'text')+'" value="'+h(val||'')+'" placeholder="'+h(ph||'')+'"></div>'}
  return '<form class="formgrid" data-form="settings">'+
    f('lugar','Dónde entregar',s.lugar,'Oficina de Convivencia de la escuela')+f('horario','Horario',s.horario,'Lunes a viernes, 8:30 a 16:00')+
    f('tallaF','Tallas de Fernanda',s.tallaF,'Ej: polera XL, pantalón 46, calzado 38')+f('tallaJ','Tallas de Jose',s.tallaJ,'Ej: talla 4, calzado 26')+
    f('contacto','Nombre de quien coordina',s.contacto,'Ej: Paula')+f('whatsapp','WhatsApp de quien coordina',s.whatsapp,'56912345678','tel')+
    '<div class="full"><button class="btn" type="submit">Guardar ajustes</button></div></form>'+
    '<p class="hint" style="margin-top:12px">Si pones un WhatsApp, el botón "Yo lo llevo" abre un mensaje a ese número. Sin número, solo indica dónde entregar.</p>';
}
function tabRegistro(){
  var log=S.log||[];
  if(!log.length)return'<p class="hint">Todavía no hay registros. Cada vez que alguien marca algo como llegado o en camino, queda anotado aquí.</p>';
  return '<ul class="log">'+log.slice(-80).reverse().map(function(l){
    var p=[];if(l.rec)p.push((l.rec>0?'+':'')+l.rec+' llegó');if(l.comp)p.push((l.comp>0?'+':'')+l.comp+' en camino');
    if(!p.length)return'';
    return'<li><time>'+h(fmtDate(l.t,true))+'</time><b>'+h(l.nombre)+'</b><span>'+h(p.join(', '))+'</span>'+(l.quien?'<span>· '+h(l.quien)+'</span>':'')+'</li>';
  }).join('')+'</ul>';
}
function adminHtml(){
  var tabs=[['recibir','Recibir'],['agregar','Agregar'],['afiche','Afiche'],['ajustes','Ajustes'],['registro','Registro']];
  var body={recibir:tabRecibir,agregar:tabAgregar,afiche:tabAfiche,ajustes:tabAjustes,registro:tabRegistro}[tab]||tabRecibir;
  return '<div class="admin"><h2>Panel de voluntarias</h2><div class="tabs" role="tablist">'+tabs.map(function(t){return'<button role="tab" data-act="tab" data-t="'+t[0]+'" aria-selected="'+(tab===t[0])+'">'+t[1]+'</button>'}).join('')+'</div>'+body()+'</div>';
}
function statusBar(){
  var label=lastErr||(inflight?'Guardando…':'Todo guardado');
  return '<div class="savebar"><div class="in"><span class="'+(lastErr?'warn':'')+'">'+h(label)+'</span><button class="btn ghost small" data-act="logout">Salir del panel</button></div></div>';
}

function render(){
  if(!S){
    app.innerHTML='<div class="wrap"><p class="kicker">Donaciones · Incendio</p><h1>Ayuda para <em>Fernanda</em> y <em>Jose</em></h1><p class="lede">'+(loadErr?'No se pudo cargar la lista. Revisa tu conexión y recarga la página.':'Cargando la lista…')+'</p></div>';
    return;
  }
  var y=window.scrollY;
  app.innerHTML='<div class="wrap">'+(admin?adminHtml():'')+publicHtml()+'</div>'+(admin?statusBar():'');
  window.scrollTo(0,y);
  if(admin&&tab==='afiche')drawFlyer();
  if(pinOpen&&!admin){var p=document.getElementById('pin');if(p&&document.activeElement!==p)p.focus()}
}

/* ---------- flyer ---------- */
function pendingByCat(){
  var groups=[];
  CATS.forEach(function(c){
    var its=S.items.filter(function(it){return it.cat===c.k&&faltan(it)>0});
    if(its.length){its.sort(function(a,b){return b.urgente-a.urgente});groups.push({c:c,its:its})}
  });
  return groups;
}
function waText(){
  var s=S.settings,lines=['*Ayuda para Fernanda y Jose*','Se les quemó la casa y todavía necesitan:',''];
  var urg=S.items.filter(function(it){return it.urgente&&faltan(it)>0});
  if(urg.length){lines.push('🔴 *URGENTE*');urg.forEach(function(it){lines.push('• '+it.nombre+' (faltan '+faltan(it)+')')});lines.push('')}
  pendingByCat().forEach(function(x){
    var rest=x.its.filter(function(it){return!it.urgente});if(!rest.length)return;
    var t=talla(x.c);lines.push('*'+x.c.n+'*'+(t?' (talla '+t+')':''));
    rest.forEach(function(it){lines.push('• '+it.nombre+' (faltan '+faltan(it)+')')});lines.push('');
  });
  lines.push('📍 Entregar en: '+(s.lugar||'Oficina de Convivencia de la escuela')+(s.horario?', '+s.horario:''));
  lines.push('📋 Lista al día: '+pageLink());
  lines.push('Solo ropa en buen estado. ¡Gracias!');
  return lines.join('\n');
}
var flyerCanvas=null;
function drawFlyer(){
  var W=1080,H=1350,cv=flyerCanvas||(flyerCanvas=document.createElement('canvas'));cv.width=W;cv.height=H;
  var g=cv.getContext('2d'),s=S.settings;
  var GREEN='#1f5e4f',SUN='#f2c230',INK='#1a2420',PAPER='#ffffff',MUTE='#56645d',RED='#b3261e',SOFT='#d8ebe4';
  var D='"Bricolage Grotesque", "Segoe UI", sans-serif',B='"Atkinson Hyperlegible", "Segoe UI", sans-serif';
  g.fillStyle=GREEN;g.fillRect(0,0,W,H);
  g.fillStyle=SUN;g.font='700 30px '+B;g.fillText('DONACIONES · INCENDIO',64,92);
  g.fillStyle=PAPER;g.font='800 84px '+D;g.fillText('Ayudemos a',64,186);g.fillText('Fernanda y Jose',64,274);
  g.font='400 32px '+B;g.fillStyle=SOFT;g.fillText('Perdieron su casa. Esto es lo que todavía les falta:',64,330);
  var px=48,py=362,pw=W-96,ph=720,room=ph-72,gap=40;
  g.fillStyle=PAPER;roundRect(g,px,py,pw,ph,22);g.fill();
  var rows=[];
  pendingByCat().forEach(function(x){var t=talla(x.c);rows.push({k:'h',t:x.c.n+(t?' · talla '+t:'')});x.its.forEach(function(it){rows.push({k:'i',it:it})})});
  if(!rows.length)rows.push({k:'h',t:'¡Por ahora no falta nada! Gracias a todos.'});
  function place(cols,size,limit){
    var lh=size*1.38,hh=size*1.9,col=0,used=0,pl=[];
    for(var i=0;i<rows.length;i++){
      var r=rows[i],need=r.k==='h'?(used?hh:size*1.4):lh;
      if(used+need>limit){col++;used=0;need=r.k==='h'?size*1.4:lh;if(col>=cols)return{pl:pl,cut:true}}
      pl.push({r:r,col:col,y:used,need:need});used+=need;
    }
    return{pl:pl,cut:false};
  }
  var cols=1,size=34,res=place(1,34,room);
  for(size=34;size>=28&&(res=place(1,size,room)).cut;size-=2){}
  if(res.cut){cols=2;for(size=28;size>=18&&(res=place(2,size,room-30)).cut;size-=1){}}
  if(res.cut){size=18;res=place(2,size,room-30-size*1.6)}
  var colW=(pw-80-(cols-1)*gap)/cols,top=py+36;
  res.pl.forEach(function(p){
    var x=px+40+p.col*(colW+gap),y=top+p.y,r=p.r;
    if(r.k==='h'){
      g.fillStyle=GREEN;g.font='800 '+Math.round(size*0.95)+'px '+D;
      g.fillText(fit(g,r.t,colW),x,y+p.need-size*0.45);
    }else{
      var it=r.it,txt='• '+it.nombre,tag=it.urgente?(cols>1?'URG.':'URGENTE'):'',cnt=(cols>1?'':'faltan ')+faltan(it);
      g.font='700 '+Math.round(size*0.6)+'px '+B;var tagW=tag?g.measureText(tag).width+size*0.8:0;
      g.font='400 '+size+'px '+B;var cntW=g.measureText(cnt).width;
      var avail=colW-cntW-size*0.6-(tag?tagW+size*0.4:0);
      g.fillStyle=INK;g.font='700 '+size+'px '+B;g.fillText(fit(g,txt,avail),x,y+size);
      g.fillStyle=MUTE;g.font='400 '+size+'px '+B;g.fillText(cnt,x+colW-cntW,y+size);
      if(tag){var th=size*0.95,tx=x+colW-cntW-size*0.4-tagW,ty=y+size*0.2;g.fillStyle=RED;roundRect(g,tx,ty,tagW,th,th/2);g.fill();g.fillStyle=PAPER;g.font='700 '+Math.round(size*0.6)+'px '+B;g.fillText(tag,tx+size*0.4,ty+th*0.7)}
    }
  });
  if(cols>1){g.fillStyle=MUTE;g.font='400 22px '+B;g.fillText('El número indica cuántos faltan.',px+40,py+ph-24)}
  if(res.cut){g.fillStyle=MUTE;g.font='700 22px '+B;var m='…y más cosas en la lista completa.';g.fillText(m,px+pw-40-g.measureText(m).width,py+ph-24)}
  var fy=py+ph+62;
  g.fillStyle=SUN;g.font='700 26px '+B;g.fillText('ENTREGAR EN',64,fy);
  g.fillStyle=PAPER;g.font='800 42px '+D;g.fillText(fit(g,s.lugar||'Oficina de Convivencia de la escuela',W-128),64,fy+50);
  g.font='400 27px '+B;g.fillStyle=SOFT;
  if(s.horario)g.fillText(fit(g,s.horario,W-128),64,fy+92);
  g.fillText(fit(g,'Lista al día: '+pageLink().replace(/^https?:\/\//,''),W-128),64,H-80);
  g.fillText(fit(g,'Ropa en buen estado, aseo y alimentos no perecibles · '+fmtDate(new Date().toISOString()),W-128),64,H-40);
  var img=document.getElementById('flyer-img');if(img)img.src=cv.toDataURL('image/png');
}
function fit(g,t,w){if(g.measureText(t).width<=w)return t;while(t.length>1&&g.measureText(t+'…').width>w)t=t.slice(0,-1);return t+'…'}
function roundRect(g,x,y,w,hh,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+hh,r);g.arcTo(x+w,y+hh,x,y+hh,r);g.arcTo(x,y+hh,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath()}
var FLYER_NAME='afiche-fernanda-y-jose.png';
function downloadFlyer(){
  if(!flyerCanvas)drawFlyer();
  var a=document.createElement('a');a.href=flyerCanvas.toDataURL('image/png');a.download=FLYER_NAME;document.body.appendChild(a);a.click();a.remove();
}

/* ---------- events ---------- */
app.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var act=b.getAttribute('data-act'),id=b.getAttribute('data-id'),it=id&&S?byId(id):null;
  if(act==='pledge'){var k=b.getAttribute('data-key');openPledge=openPledge===k?null:k;render();return}
  if(act==='openpin'){pinOpen=true;pinErr='';render();return}
  if(act==='tab'){tab=b.getAttribute('data-t');editId=null;confirmDel=null;ss.set('fj-tab',tab);render();return}
  if(act==='step'&&it){
    var f=b.getAttribute('data-f'),d=+b.getAttribute('data-d');
    if(it[f]+d<0)return;
    it[f]+=d;if(f==='recibido'&&d>0&&it.comprometido>0)it.comprometido--;
    send({op:'step',id:id,field:f,d:d});return;
  }
  if(act==='urg'&&it){it.urgente=!it.urgente;send({op:'urg',id:id});return}
  if(act==='edit'){editId=editId===id?null:id;confirmDel=null;render();return}
  if(act==='editcancel'){editId=null;confirmDel=null;render();return}
  if(act==='del'){confirmDel=id;render();return}
  if(act==='delyes'){S.items=S.items.filter(function(x){return x.id!==id});editId=null;confirmDel=null;send({op:'del',id:id});toast('Quitado de la lista.');return}
  if(act==='logout'){logout();render();load();return}
  if(act==='copytxt'){
    var txt=waText(),ta=document.getElementById('wa-text');
    var fallback=function(){ta.focus();ta.select();toast('Texto seleccionado. Cópialo y pégalo en WhatsApp.')};
    try{navigator.clipboard.writeText(txt).then(function(){toast('Texto copiado. Pégalo en WhatsApp junto a la imagen.')},fallback)}catch(err){fallback()}
    return;
  }
  if(act==='dlflyer'){downloadFlyer();return}
  if(act==='shareflyer'){
    if(!flyerCanvas)drawFlyer();
    flyerCanvas.toBlob(function(blob){
      var file=new File([blob],FLYER_NAME,{type:'image/png'});
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        navigator.share({files:[file],text:waText()}).catch(function(){});
      }else downloadFlyer();
    },'image/png');
    return;
  }
});
app.addEventListener('input',function(e){if(e.target.id==='quien'){quien=e.target.value;ss.set('fj-quien',quien)}});
app.addEventListener('submit',function(e){
  e.preventDefault();
  var f=e.target,kind=f.getAttribute('data-form'),fd=new FormData(f);
  if(kind==='pin'){
    var v=(document.getElementById('pin').value||'').trim();if(!v)return;
    pinErr='';
    fetch('/api/ayuda',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:v,op:'load'})})
      .then(function(r){return r.json().then(function(j){return{status:r.status,j:j}})})
      .then(function(x){
        if(x.status===403){pinErr='PIN incorrecto. Pídelo a quien coordina.';render();return}
        if(!x.j.ok)throw 0;
        pin=v;admin=true;pinOpen=false;ss.set('fj-pin',v);S=x.j.state;window.scrollTo(0,0);render();
      })
      .catch(function(){pinErr='No se pudo conectar. Intenta de nuevo.';render()});
    return;
  }
  if(kind==='add'){
    var nombre=String(fd.get('nombre')||'').trim(),n=parseInt(fd.get('necesitado'),10);
    if(!nombre||!(n>0))return;
    send({op:'add',nombre:nombre,cat:fd.get('cat'),necesitado:n,nota:String(fd.get('nota')||'').trim(),urgente:!!fd.get('urgente')});
    toast('"'+nombre+'" agregado a la lista.');return;
  }
  if(kind==='edit'){
    var id=f.getAttribute('data-id');
    send({op:'edit',id:id,nombre:fd.get('nombre'),necesitado:parseInt(fd.get('necesitado'),10)||1,cat:fd.get('cat'),nota:fd.get('nota')});
    editId=null;confirmDel=null;return;
  }
  if(kind==='settings'){
    var st={};['lugar','horario','tallaF','tallaJ','contacto','whatsapp'].forEach(function(k){st[k]=String(fd.get(k)||'').trim()});
    send({op:'settings',settings:st});toast('Ajustes guardados.');return;
  }
});

/* ---------- start ---------- */
render();
load();
setInterval(function(){
  if(document.hidden||inflight||editId)return;
  var a=document.activeElement;if(a&&/INPUT|TEXTAREA|SELECT/.test(a.tagName))return;
  load();
},30000);
document.addEventListener('visibilitychange',function(){if(!document.hidden&&!inflight&&!editId)load()});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(function(){if(admin&&tab==='afiche'&&S)drawFlyer()});
})();
