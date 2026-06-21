import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { vizData, memoryLink, memoryUnlink, memoryAll } from '../api.js'
import { showToast } from '../utils/toast.js'

// 星图 · 完整照搬 v66（public/legacy/index.html line 3254-3568）
// 只做必要的"全局依赖 → React 注入"转换：
//   callAPI('/api/viz-data')     → vizData()
//   callAPI('/api/link',...)     → memoryLink(a, b)
//   callAPI('/api/unlink',...)   → memoryUnlink(a, b)
//   memoriesData[]               → await memoryAll()
//   openEditor(...)              → navigate('/memory/' + id)
//   showToast(...)               → 来自 ../utils/toast.js
// 其余 GX 对象 / GX_COLORS / GX_CATS / GX_CAT_ZH / 所有 gx* 函数：一字不改

export default function Galaxy({ focusId = null }) {
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const focusIdRef = useRef(focusId)
  focusIdRef.current = focusId

  useEffect(() => {
    if (!rootRef.current) return

    // ─── 以下为 v66 line 3254-3568 原样照搬，仅在末尾把外部依赖切到 React/项目 API ───
    var GX = { loaded:false, nodes:[], byId:{}, edges:[], edgeSeen:{}, haslink:{},
      W:0, H:0, mode:'relation', focusId:null, edgesVisible:true,
      linkSource:null, edgesBeforeLink:true, pendingDelKey:null,
      pressTimer:null, pressId:null, pressXY:null, suppressClick:false,
      catAnchor:{}, catCached:false, animRAF:null, curTipId:null, bound:false,
      view:{k:1,tx:0,ty:0}, ptrs:{}, gesture:null, panStart:null, pinchStart:null, gestureEndAt:0, searchActive:false,
      eN:{}, eH:{}, eL:{}, eE:{}, eHit:{}, catLabel:{}, el:{} };
    var GX_COLORS = { core:'#C6613F', scene:'#8B9D7F', emotion:'#C99B8B', semantic:'#6B655E', image:'#A8956B', procedure:'#7A8B99' };
    var GX_CATS = ['core','scene','emotion','semantic','image','procedure'];
    var GX_CAT_ZH = { core:'核心', scene:'情景', emotion:'情绪', semantic:'语义', image:'形象', procedure:'程序' };

    // 跟 v66 原版一致：用 document.getElementById（主 App 同时只有一个 Galaxy 实例，id 唯一）
    function $id(id){ return document.getElementById(id); }

    function gxKey(a,b){ return [a,b].sort().join('|'); }
    function gxFloatStyle(i){ var dur=6+(i%7)*0.5; var dly=-((i*1.37)%dur); return 'animation-delay:'+dly.toFixed(2)+'s;animation-duration:'+dur.toFixed(2)+'s;'; }
    function gxBuildLegend(){ var el=$id('galaxyLegend'); if(!el)return; el.innerHTML=GX_CATS.map(function(c){ return '<div class="gx-leg-item"><i style="background:'+GX_COLORS[c]+'"></i>'+GX_CAT_ZH[c]+'</div>'; }).join(''); }
    function gxBaseR(n){ return GX.haslink[n.id] ? (2.6+n.importance*0.4) : (2.2+n.importance*0.24); }
    function gxHaloR(n){ return 6+n.importance*0.7; }
    function gxClampK(k){ return Math.min(8, Math.max(0.5, k)); }
    function gxApplyView(){ if(GX.el.viewport) GX.el.viewport.setAttribute('transform','translate('+GX.view.tx+','+GX.view.ty+') scale('+GX.view.k+')'); }
    function gxZoomAt(mx,my,factor){ var k=gxClampK(GX.view.k*factor); var gx=(mx-GX.view.tx)/GX.view.k, gy=(my-GX.view.ty)/GX.view.k; GX.view.k=k; GX.view.tx=mx-gx*k; GX.view.ty=my-gy*k; gxApplyView(); }
    function gxResetView(){ GX.view={k:1,tx:0,ty:0}; gxApplyView(); }
    function gxCenterOn(id){ var n=GX.byId[id]; if(!n)return; var k=gxClampK(Math.max(GX.view.k,1.6)); GX.view.k=k; GX.view.tx=GX.W/2-n.x*k; GX.view.ty=GX.H/2-n.y*k; gxApplyView(); }
    function gxEsc(s){ return (s||'').replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
    function gxRelX(n){ return GX.W/2 + n.ox * GX.W*0.42; }
    function gxRelY(n){ return GX.H/2 + n.oy * GX.H*0.42; }

    async function gxLoad(){
      // 原：var data = await callAPI('/api/viz-data');
      var data = await vizData();
      GX.nodes = (data.nodes||[]).filter(function(n){ return !n.archived; }).map(function(n){
        return { id:n.id, content:n.content||'', category:GX_COLORS[n.category]?n.category:'semantic', importance:n.importance||5,
          ox:(n.x||0), oy:(n.y||0), x:0, y:0, catX:0, catY:0,
          linked:(n.linked||[]).slice(), link_rel:n.link_rel||{} };
      });
      GX.byId = {}; GX.nodes.forEach(function(n){ GX.byId[n.id]=n; });
      GX.edges = []; GX.edgeSeen = {};
      GX.nodes.forEach(function(n){ (n.linked||[]).forEach(function(l){
        var k = gxKey(n.id,l); if (GX.edgeSeen[k] || !GX.byId[l]) return; GX.edgeSeen[k]=1;
        GX.edges.push({ source:n.id, target:l, key:k });
      }); });
      GX.haslink = {}; GX.nodes.forEach(function(n){ if((n.linked||[]).length) GX.haslink[n.id]=1; });
      GX.catCached = false;
      GX.loaded = true;
    }

    function gxSize(){ var c=GX.el.container; GX.W=c.clientWidth; GX.H=c.clientHeight; GX.el.svg.setAttribute('viewBox','0 0 '+GX.W+' '+GX.H); gxComputeAnchors(); }
    function gxComputeAnchors(){ var cx=GX.W/2, cy=GX.H*0.5, R=Math.min(GX.W,GX.H)*0.33; GX_CATS.forEach(function(c,k){ var a=(k/6)*Math.PI*2 - Math.PI/2; GX.catAnchor[c]={ x:cx+Math.cos(a)*R, y:cy+Math.sin(a)*R }; }); }

    function gxComputeCatLayout(){
      GX.nodes.forEach(function(n){ var a=GX.catAnchor[n.category]||{x:GX.W/2,y:GX.H/2}; n.catX=a.x+(Math.random()-0.5)*40; n.catY=a.y+(Math.random()-0.5)*40; n._cvx=0; n._cvy=0; });
      for(var it=0; it<170; it++){
        GX.nodes.forEach(function(n){ var a=GX.catAnchor[n.category]||{x:GX.W/2,y:GX.H/2}; n._cvx+=(a.x-n.catX)*0.03; n._cvy+=(a.y-n.catY)*0.03; });
        for(var p=0;p<GX.nodes.length;p++)for(var q=p+1;q<GX.nodes.length;q++){ var A=GX.nodes[p],B=GX.nodes[q]; var dx=B.catX-A.catX,dy=B.catY-A.catY,d=Math.sqrt(dx*dx+dy*dy)||1; if(d>110)continue; var f=420/(d*d),fx=dx/d*f,fy=dy/d*f; A._cvx-=fx;A._cvy-=fy;B._cvx+=fx;B._cvy+=fy; }
        GX.nodes.forEach(function(n){ n._cvx*=0.84;n._cvy*=0.84;n.catX+=n._cvx;n.catY+=n._cvy; var m=26;n.catX=Math.max(m,Math.min(GX.W-m,n.catX));n.catY=Math.max(m,Math.min(GX.H-m,n.catY)); });
      }
      GX.catCached = true;
    }

    function gxSetTargets(){
      if(GX.mode==='relation'){ GX.nodes.forEach(function(n){ n._tx=gxRelX(n); n._ty=gxRelY(n); }); }
      else { if(!GX.catCached)gxComputeCatLayout(); GX.nodes.forEach(function(n){ n._tx=n.catX; n._ty=n.catY; }); }
    }
    function gxSnap(){ GX.nodes.forEach(function(n){ n.x=n._tx; n.y=n._ty; }); }
    function gxAnimate(){
      if(GX.animRAF)cancelAnimationFrame(GX.animRAF);
      var f=0;
      function tick(){ f++; var mv=false; GX.nodes.forEach(function(n){ n.x+=(n._tx-n.x)*0.16; n.y+=(n._ty-n.y)*0.16; if(Math.abs(n._tx-n.x)>0.5||Math.abs(n._ty-n.y)>0.5)mv=true; }); gxPaint(); if(mv&&f<140)GX.animRAF=requestAnimationFrame(tick); else GX.animRAF=null; }
      GX.animRAF=requestAnimationFrame(tick);
    }

    function gxMkLine(cls,id){ var l=document.createElementNS('http://www.w3.org/2000/svg','line'); l.setAttribute('class',cls); if(id)l.id=id; return l; }
    function gxAppendEdge(e){
      var vis=gxMkLine('gx-edge','gxe_'+e.key); vis.setAttribute('stroke','rgba(107,101,94,0.18)'); vis.setAttribute('stroke-width','0.6');
      var hit=gxMkLine('gx-edge-hit'); hit.setAttribute('data-key',e.key);
      GX.el.edgeLayer.appendChild(vis); GX.el.edgeLayer.appendChild(hit); GX.eE[e.key]=vis; GX.eHit[e.key]=hit;
    }
    function gxBuild(){
      var h='<g id="gxEdgeLayer"></g>';
      GX.nodes.forEach(function(n,i){ var c=GX_COLORS[n.category]; var lk=GX.haslink[n.id]; h+='<circle class="gx-halo" id="gxh_'+n.id+'" style="'+gxFloatStyle(i)+'" fill="'+c+'" fill-opacity="'+(lk?0.15:0)+'" r="'+(lk?gxHaloR(n):0)+'"/>'; });
      GX.nodes.forEach(function(n,i){ var c=GX_COLORS[n.category]; var lk=GX.haslink[n.id]; h+='<circle class="gx-core" id="gxn_'+n.id+'" data-id="'+n.id+'" style="'+gxFloatStyle(i)+'" fill="'+c+'" fill-opacity="'+(lk?1:0.55)+'" r="'+gxBaseR(n)+'"/>'; });
      GX_CATS.forEach(function(c){ h+='<g class="gx-cat" id="gxc_'+c+'" opacity="0"><text class="gx-cat-zh" text-anchor="middle" font-size="15" fill="'+GX_COLORS[c]+'" font-weight="600"></text><text class="gx-cat-num" text-anchor="middle" font-size="11" fill="#A8A39B"></text></g>'; });
      GX.nodes.forEach(function(n){ h+='<g class="gx-label" id="gxl_'+n.id+'" opacity="0"><rect class="gx-label-bg" rx="4"/><text class="gx-label-text" text-anchor="middle"></text></g>'; });
      GX.el.svg.innerHTML='<g id="gxViewport">'+h+'</g>';
      GX.el.viewport=GX.el.svg.querySelector('#gxViewport'); gxApplyView();
      GX.el.edgeLayer=GX.el.svg.querySelector('#gxEdgeLayer');
      GX.eN={};GX.eH={};GX.eL={};GX.eE={};GX.eHit={};
      GX.edges.forEach(function(e){ gxAppendEdge(e); });
      GX.nodes.forEach(function(n){ GX.eN[n.id]=GX.el.svg.querySelector('#gxn_'+CSS.escape(n.id)); GX.eH[n.id]=GX.el.svg.querySelector('#gxh_'+CSS.escape(n.id)); GX.eL[n.id]=GX.el.svg.querySelector('#gxl_'+CSS.escape(n.id)); GX.eL[n.id].querySelector('text').textContent=(n.content||'').slice(0,15); });
      GX.catLabel={}; GX_CATS.forEach(function(c){ var g=GX.el.svg.querySelector('#gxc_'+c); var cnt=GX.nodes.filter(function(n){return n.category===c;}).length; g.querySelector('.gx-cat-zh').textContent=GX_CAT_ZH[c]; g.querySelector('.gx-cat-num').textContent=cnt+' 颗'; GX.catLabel[c]=g; });
    }
    function gxPaint(){
      GX.edges.forEach(function(e){ var a=GX.byId[e.source],b=GX.byId[e.target]; var v=GX.eE[e.key],ht=GX.eHit[e.key]; if(v){v.setAttribute('x1',a.x);v.setAttribute('y1',a.y);v.setAttribute('x2',b.x);v.setAttribute('y2',b.y);} if(ht){ht.setAttribute('x1',a.x);ht.setAttribute('y1',a.y);ht.setAttribute('x2',b.x);ht.setAttribute('y2',b.y);} });
      GX.nodes.forEach(function(n){ GX.eN[n.id].setAttribute('cx',n.x);GX.eN[n.id].setAttribute('cy',n.y); GX.eH[n.id].setAttribute('cx',n.x);GX.eH[n.id].setAttribute('cy',n.y); if(GX.eL[n.id].getAttribute('opacity')!=='0')gxPosLabel(n); });
      if(GX.mode==='category'){ GX_CATS.forEach(function(c){ var a=GX.catAnchor[c]; var g=GX.catLabel[c]; var off=Math.min(GX.W,GX.H)*0.13; g.querySelector('.gx-cat-zh').setAttribute('x',a.x); g.querySelector('.gx-cat-zh').setAttribute('y',a.y-off); g.querySelector('.gx-cat-num').setAttribute('x',a.x); g.querySelector('.gx-cat-num').setAttribute('y',a.y-off+16); }); }
    }
    function gxPosLabel(n){ var g=GX.eL[n.id],txt=g.querySelector('text'),rect=g.querySelector('rect'); var ty=n.y-(GX.haslink[n.id]?(6+n.importance):8)-9; txt.setAttribute('x',n.x);txt.setAttribute('y',ty); var bb=txt.getBBox(); rect.setAttribute('x',bb.x-7);rect.setAttribute('y',bb.y-3);rect.setAttribute('width',bb.width+14);rect.setAttribute('height',bb.height+6); }
    function gxRefreshNode(id){ var n=GX.byId[id],lk=GX.haslink[id]; GX.eN[id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[id].setAttribute('fill-opacity',lk?1:0.55); GX.eN[id].setAttribute('r',gxBaseR(n)); GX.eN[id].classList.remove('gx-pulse'); GX.eH[id].setAttribute('fill',GX_COLORS[n.category]); GX.eH[id].setAttribute('fill-opacity',lk?0.15:0); GX.eH[id].setAttribute('r',lk?gxHaloR(n):0); }

    function gxApplyFocus(id){
      GX.focusId=id;
      var node=GX.byId[id]; var rel=(node.linked||[]).filter(function(l){return GX.byId[l];}); var keep={}; keep[id]=1; rel.forEach(function(l){keep[l]=1;});
      GX.nodes.forEach(function(n){ var on=keep[n.id];
        if(on){ GX.eN[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[n.id].setAttribute('fill-opacity','1'); GX.eN[n.id].setAttribute('r',gxBaseR(n)*(n.id===id?1.6:1.28)); GX.eH[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eH[n.id].setAttribute('fill-opacity',n.id===id?0.24:0.18); GX.eH[n.id].setAttribute('r',gxHaloR(n)+2); }
        else { GX.eN[n.id].setAttribute('fill','#BDB9B2'); GX.eN[n.id].setAttribute('fill-opacity','0.5'); GX.eN[n.id].setAttribute('r',gxBaseR(n)); GX.eH[n.id].setAttribute('fill-opacity','0'); } });
      GX.edges.forEach(function(e){ var r=(e.source===id||e.target===id); var el=GX.eE[e.key]; if(r)el.classList.add('gx-flow'); else el.classList.remove('gx-flow'); el.setAttribute('stroke', r?'var(--accent)':'rgba(189,185,178,0.35)'); el.setAttribute('stroke-width', r?'1.5':'0.5'); el.style.strokeOpacity = r?'1':'0.25'; });
      GX.nodes.forEach(function(n){ var sh=keep[n.id]; GX.eL[n.id].setAttribute('opacity',sh?'1':'0'); if(sh)gxPosLabel(n); });
      gxTipShow(id);
      GX.el.hint.textContent='点空白处取消聚焦'; GX.el.hint.style.opacity='0.85';
    }
    function gxClearFocus(){
      GX.focusId=null;
      GX.nodes.forEach(function(n){ gxRefreshNode(n.id); GX.eL[n.id].setAttribute('opacity','0'); });
      GX.edges.forEach(function(e){ var el=GX.eE[e.key]; el.classList.remove('gx-flow'); el.setAttribute('stroke','rgba(107,101,94,0.18)'); el.setAttribute('stroke-width','0.6'); el.style.strokeOpacity=GX.edgesVisible?'1':'0'; });
      gxTipHide();
      GX.el.hint.textContent='长按一颗星 → 连藤 · 点连线 → 拆藤 · 点空白恢复'; GX.el.hint.style.opacity='0.85';
    }
    function gxClearSearch(){ GX.searchActive=false; GX.el.search.value=''; if(GX.focusId)gxClearFocus(); else GX.nodes.forEach(function(n){ var lk=GX.haslink[n.id]; GX.eN[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[n.id].setAttribute('fill-opacity',lk?1:0.55); }); }

    function gxTipShow(id){ GX.curTipId=id; var tip=GX.el.tip; tip.innerHTML='<div class="gt-title">'+gxEsc(GX.byId[id].content)+'</div><div class="gt-open" data-act="open">打开</div><div class="gt-close" data-act="close">✕</div>'; tip.classList.add('show'); }
    function gxTipHide(){ GX.curTipId=null; GX.el.tip.classList.remove('show'); }
    function gxOpenCard(id){
      // 原：从 memoriesData 找；这里直接走 React 路由
      gxClose(); navigate('/memory/' + id);
    }

    function gxSetEdges(on){ GX.edgesVisible=on; GX.el.edgeBtn.className=on?'galaxy-btn on':'galaxy-btn'; GX.edges.forEach(function(e){ var el=GX.eE[e.key]; if(el){ if(on){ var hl=el.getAttribute('stroke').indexOf('accent')>=0; el.style.strokeOpacity = GX.focusId ? (hl?'1':'0.25') : '1'; } else { el.style.strokeOpacity='0'; el.classList.remove('gx-flow'); } } }); }
    function gxBanner(txt,auto){ var b=GX.el.banner; b.textContent=txt; b.classList.add('show'); if(auto)setTimeout(function(){b.classList.remove('show');},auto); }
    function gxHideBanner(){ GX.el.banner.classList.remove('show'); }

    function gxStartLink(id){
      GX.linkSource=id;
      GX.edgesBeforeLink=GX.edgesVisible; if(!GX.edgesVisible)gxSetEdges(true);
      GX.nodes.forEach(function(n){ if(n.id===id)GX.eN[n.id].classList.add('gx-pulse'); else GX.eN[n.id].classList.remove('gx-pulse'); });
      GX.eN[id].setAttribute('r', gxBaseR(GX.byId[id])*1.5);
      gxBanner('再点另一颗星 → 连成一条藤');
      GX.el.hint.style.opacity='0';
    }
    function gxEndLink(){
      if(GX.linkSource){ GX.eN[GX.linkSource].classList.remove('gx-pulse'); gxRefreshNode(GX.linkSource); }
      GX.linkSource=null; gxSetEdges(GX.edgesBeforeLink); gxHideBanner();
      GX.el.hint.style.opacity='0.85';
    }
    function gxTryConnect(a,b){
      if(a===b){ gxEndLink(); return; }
      var k=gxKey(a,b);
      if(GX.eE[k]){ gxBanner('这两颗已经连着了',1400); gxEndLink(); return; }
      gxAddEdge(a,b); gxEndLink();
    }
    async function gxAddEdge(a,b){
      var k=gxKey(a,b);
      GX.byId[a].linked=GX.byId[a].linked||[]; if(GX.byId[a].linked.indexOf(b)<0)GX.byId[a].linked.push(b);
      GX.byId[b].linked=GX.byId[b].linked||[]; if(GX.byId[b].linked.indexOf(a)<0)GX.byId[b].linked.push(a);
      GX.haslink[a]=1;GX.haslink[b]=1;
      var e={source:a,target:b,key:k}; GX.edges.push(e); GX.edgeSeen[k]=1; gxAppendEdge(e);
      gxRefreshNode(a);gxRefreshNode(b);
      var A=GX.byId[a],B=GX.byId[b]; var v=GX.eE[k]; if(v){v.setAttribute('x1',A.x);v.setAttribute('y1',A.y);v.setAttribute('x2',B.x);v.setAttribute('y2',B.y);} var ht=GX.eHit[k]; if(ht){ht.setAttribute('x1',A.x);ht.setAttribute('y1',A.y);ht.setAttribute('x2',B.x);ht.setAttribute('y2',B.y);}
      gxBanner('连好了 ✓',1400);
      try {
        // 原：var res = await callAPI('/api/link', { method:'POST', body: JSON.stringify({ from_id:a, to_id:b }) });
        var res = await memoryLink(a, b);
        if(res && res.error){ throw new Error(res.error); }
      } catch(err){
        gxRemoveEdgeLocal(k); gxBanner('没连上，撤回了',1800);
      }
    }
    function gxRemoveEdgeLocal(k){
      var idx=-1; for(var p=0;p<GX.edges.length;p++){ if(GX.edges[p].key===k){ idx=p; break; } }
      if(idx<0)return; var e=GX.edges[idx];
      GX.byId[e.source].linked=(GX.byId[e.source].linked||[]).filter(function(x){return x!==e.target;});
      GX.byId[e.target].linked=(GX.byId[e.target].linked||[]).filter(function(x){return x!==e.source;});
      if(!(GX.byId[e.source].linked||[]).length)delete GX.haslink[e.source];
      if(!(GX.byId[e.target].linked||[]).length)delete GX.haslink[e.target];
      GX.edges.splice(idx,1); delete GX.edgeSeen[k];
      if(GX.eE[k]){GX.eE[k].remove();delete GX.eE[k];} if(GX.eHit[k]){GX.eHit[k].remove();delete GX.eHit[k];}
      gxRefreshNode(e.source);gxRefreshNode(e.target);
    }
    async function gxRemoveEdge(k){
      var idx=-1; for(var p=0;p<GX.edges.length;p++){ if(GX.edges[p].key===k){ idx=p; break; } }
      if(idx<0)return; var e=GX.edges[idx]; var a=e.source, b=e.target;
      gxRemoveEdgeLocal(k);
      try {
        // 原：var res = await callAPI('/api/unlink', { method:'POST', body: JSON.stringify({ from_id:a, to_id:b }) });
        var res = await memoryUnlink(a, b);
        if(res && res.error){ throw new Error(res.error); }
        gxBanner('拆掉了',1200);
      } catch(err){
        gxAddEdge(a,b); gxBanner('没拆成，恢复了',1800);
      }
    }

    function gxAskRemove(k){ if(GX.linkSource)return; GX.pendingDelKey=k; if(GX.eE[k])GX.eE[k].classList.add('gx-del'); GX.el.confirm.classList.add('show'); }
    function gxCloseConfirm(){ if(GX.pendingDelKey&&GX.eE[GX.pendingDelKey])GX.eE[GX.pendingDelKey].classList.remove('gx-del'); GX.pendingDelKey=null; GX.el.confirm.classList.remove('show'); }

    function gxOnTap(ev){
      if(GX.gestureEndAt && Date.now()-GX.gestureEndAt<350){ return; }
      if(GX.suppressClick){ GX.suppressClick=false; return; }
      var t=ev.target;
      if(t.classList && t.classList.contains('gx-edge-hit')){ gxAskRemove(t.getAttribute('data-key')); return; }
      var isNode=t.classList && t.classList.contains('gx-core');
      if(GX.linkSource){ if(isNode)gxTryConnect(GX.linkSource,t.getAttribute('data-id')); else gxEndLink(); return; }
      if(GX.pendingDelKey){ gxCloseConfirm(); return; }
      if(!isNode){ if(GX.searchActive)return; if(GX.focusId)gxClearFocus(); return; }
      var id=t.getAttribute('data-id');
      if(GX.mode==='category')gxTipShow(id); else gxApplyFocus(id);
    }
    function gxPtrPos(e){ var r=GX.el.container.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
    function gxOnDown(e){
      var p=gxPtrPos(e); GX.ptrs[e.pointerId]={x:p.x,y:p.y};
      var ids=Object.keys(GX.ptrs);
      if(ids.length>=2){
        if(GX.pressTimer){clearTimeout(GX.pressTimer);GX.pressTimer=null;}
        GX.gesture='pinch'; GX.suppressClick=true; GX.panStart=null;
        var a=GX.ptrs[ids[0]], b=GX.ptrs[ids[1]]; var dx=b.x-a.x, dy=b.y-a.y;
        GX.pinchStart={ d:Math.sqrt(dx*dx+dy*dy)||1, mx:(a.x+b.x)/2, my:(a.y+b.y)/2, k:GX.view.k, tx:GX.view.tx, ty:GX.view.ty };
        return;
      }
      var t=e.target; var onNode=t.classList&&t.classList.contains('gx-core');
      if(onNode){
        GX.pressId=t.getAttribute('data-id'); GX.pressXY=[p.x,p.y]; GX.suppressClick=false; GX.panStart=null;
        if(GX.pressTimer)clearTimeout(GX.pressTimer);
        GX.pressTimer=setTimeout(function(){ GX.pressTimer=null; GX.suppressClick=true; gxStartLink(GX.pressId); }, 480);
      } else {
        GX.panStart={x:p.x,y:p.y,tx:GX.view.tx,ty:GX.view.ty};
      }
    }
    function gxOnMove(e){
      if(!GX.ptrs[e.pointerId])return;
      var p=gxPtrPos(e); GX.ptrs[e.pointerId]={x:p.x,y:p.y};
      var ids=Object.keys(GX.ptrs);
      if(GX.gesture==='pinch' && ids.length>=2){
        var a=GX.ptrs[ids[0]], b=GX.ptrs[ids[1]]; var dx=b.x-a.x, dy=b.y-a.y; var d=Math.sqrt(dx*dx+dy*dy)||1;
        var mx=(a.x+b.x)/2, my=(a.y+b.y)/2; var ps=GX.pinchStart;
        var k=gxClampK(ps.k*(d/ps.d)); var gx=(ps.mx-ps.tx)/ps.k, gy=(ps.my-ps.ty)/ps.k;
        GX.view.k=k; GX.view.tx=mx-gx*k; GX.view.ty=my-gy*k; gxApplyView(); return;
      }
      if(GX.pressTimer&&GX.pressXY){ var ex=p.x-GX.pressXY[0],ey=p.y-GX.pressXY[1]; if(ex*ex+ey*ey>120){ clearTimeout(GX.pressTimer); GX.pressTimer=null; } }
      if(GX.panStart){
        var px=p.x-GX.panStart.x, py=p.y-GX.panStart.y;
        if(GX.gesture==='pan' || px*px+py*py>80){ GX.gesture='pan'; GX.suppressClick=true; GX.view.tx=GX.panStart.tx+px; GX.view.ty=GX.panStart.ty+py; gxApplyView(); }
      }
    }
    function gxOnUp(e){
      delete GX.ptrs[e.pointerId];
      if(GX.pressTimer){clearTimeout(GX.pressTimer);GX.pressTimer=null;}
      if(GX.gesture==='pan'||GX.gesture==='pinch')GX.gestureEndAt=Date.now();
      var ids=Object.keys(GX.ptrs);
      if(ids.length===1){ var pp=GX.ptrs[ids[0]]; GX.panStart={x:pp.x,y:pp.y,tx:GX.view.tx,ty:GX.view.ty}; GX.pinchStart=null; GX.gesture=null; }
      else if(ids.length===0){ GX.gesture=null; GX.panStart=null; GX.pinchStart=null; }
    }

    function gxSwitchMode(m){
      if(m===GX.mode)return; if(GX.linkSource)gxEndLink(); if(GX.focusId)gxClearFocus(); gxCloseConfirm();
      GX.searchActive=false; gxResetView();
      GX.mode=m;
      $id('galaxySegRel').className=m==='relation'?'active':'';
      $id('galaxySegCat').className=m==='category'?'active':'';
      GX.el.search.value='';
      GX_CATS.forEach(function(c){ GX.catLabel[c].setAttribute('opacity',m==='category'?'1':'0'); });
      GX.edges.forEach(function(e){ GX.eE[e.key].classList.remove('gx-flow'); GX.eE[e.key].setAttribute('stroke','rgba(107,101,94,0.18)'); GX.eE[e.key].setAttribute('stroke-width','0.6'); });
      gxSetEdges(m==='relation');
      GX.nodes.forEach(function(n){ gxRefreshNode(n.id); GX.eL[n.id].setAttribute('opacity','0'); });
      gxTipHide(); GX.el.hint.style.opacity='0.85';
      gxSetTargets(); gxAnimate();
    }

    function gxSearch(){
      var q=GX.el.search.value.trim().toLowerCase();
      if(GX.searchActive){ GX.searchActive=false; if(GX.focusId)gxClearFocus(); }
      if(!q){ if(!GX.focusId)GX.nodes.forEach(function(n){ var lk=GX.haslink[n.id]; GX.eN[n.id].setAttribute('fill',GX_COLORS[n.category]); GX.eN[n.id].setAttribute('fill-opacity',lk?1:0.55); }); return; }
      if(GX.focusId)gxClearFocus();
      GX.nodes.forEach(function(n){ var hit=(n.content||'').toLowerCase().indexOf(q)>=0; GX.eN[n.id].setAttribute('fill', hit?GX_COLORS[n.category]:'#BDB9B2'); GX.eN[n.id].setAttribute('fill-opacity', hit?1:0.45); });
    }

    async function openGalaxy(centerId){
      GX.el.overlay = $id('galaxyOverlay');
      GX.el.container = $id('galaxyContainer');
      GX.el.svg = $id('galaxySvg');
      GX.el.tip = $id('galaxyTooltip');
      GX.el.banner = $id('galaxyBanner');
      GX.el.confirm = $id('galaxyConfirm');
      GX.el.hint = $id('galaxyHint');
      GX.el.search = $id('galaxySearch');
      GX.el.edgeBtn = $id('galaxyEdgeBtn');
      GX.el.overlay.classList.add('active');
      try { await gxLoad(); } catch(e){ showToast('星图数据加载失败'); return; }
      if(!GX.nodes.length){ showToast('还没有可显示的记忆坐标'); return; }
      gxSize();
      GX.mode='relation';
      $id('galaxySegRel').className='active';
      $id('galaxySegCat').className='';
      GX.focusId=null; GX.linkSource=null; GX.pendingDelKey=null;
      GX.searchActive=false; GX.view={k:1,tx:0,ty:0}; GX.ptrs={}; GX.gesture=null;
      gxBuild();
      gxBuildLegend();
      gxSetEdges(true);
      gxSetTargets(); gxSnap(); gxPaint();
      GX.el.search.value=''; GX.el.hint.textContent='长按一颗星 → 连藤 · 点连线 → 拆藤 · 点空白恢复'; GX.el.hint.style.opacity='0.85';
      if(!GX.bound){
        GX.el.svg.addEventListener('click', gxOnTap);
        GX.el.svg.addEventListener('pointerdown', gxOnDown);
        GX.el.svg.addEventListener('pointermove', gxOnMove);
        GX.el.svg.addEventListener('pointerup', gxOnUp);
        GX.el.svg.addEventListener('pointercancel', gxOnUp);
        GX.el.svg.addEventListener('wheel', function(e){ e.preventDefault(); var p=gxPtrPos(e); gxZoomAt(p.x,p.y, e.deltaY<0?1.12:0.893); }, {passive:false});
        GX.el.tip.addEventListener('click', function(ev){ var act=ev.target&&ev.target.getAttribute&&ev.target.getAttribute('data-act'); if(act==='close'){ gxTipHide(); return; } if(GX.curTipId)gxOpenCard(GX.curTipId); });
        GX.el.search.addEventListener('input', gxSearch);
        GX.el.search.addEventListener('keydown', function(e){ if(e.key==='Enter'){ var q=GX.el.search.value.trim().toLowerCase(); if(!q)return; var m=GX.nodes.find(function(n){return (n.content||'').toLowerCase().indexOf(q)>=0;}); if(m){ GX.el.search.blur(); GX.searchActive=true; if(GX.mode==='relation')gxApplyFocus(m.id); else gxTipShow(m.id); gxCenterOn(m.id); } else { showToast('没找到包含「'+q+'」的记忆'); } } });
        GX.el.edgeBtn.addEventListener('click', function(){ gxSetEdges(!GX.edgesVisible); });
        $id('galaxySegRel').addEventListener('click', function(){ gxSwitchMode('relation'); });
        $id('galaxySegCat').addEventListener('click', function(){ gxSwitchMode('category'); });
        $id('galaxyCancel').addEventListener('click', gxCloseConfirm);
        $id('galaxyDel').addEventListener('click', function(){ if(GX.pendingDelKey){ var k=GX.pendingDelKey; GX.pendingDelKey=null; GX.el.confirm.classList.remove('show'); gxRemoveEdge(k); } });
        GX.bound=true;
      }
      if(centerId && GX.byId[centerId]){ setTimeout(function(){ gxApplyFocus(centerId); gxCenterOn(centerId); }, 320); }
    }
    function gxClose(){ var o=$id('galaxyOverlay'); if(o)o.classList.remove('active'); if(GX.animRAF){cancelAnimationFrame(GX.animRAF);GX.animRAF=null;} }

    // ─── 入口：mount 后立刻 openGalaxy ───
    openGalaxy(focusIdRef.current);

    // resize 监听
    function onResize(){ if(GX.loaded){ gxSize(); gxComputeAnchors(); gxSetTargets(); gxSnap(); gxPaint(); } }
    window.addEventListener('resize', onResize);

    // cleanup
    return () => {
      window.removeEventListener('resize', onResize);
      if (GX.animRAF) cancelAnimationFrame(GX.animRAF);
    };
  }, []) // 仅 mount 一次

  // ─── JSX 模板：照搬 public/legacy/index.html line 1315-1333 ───
  // class → className，自闭合标签，移除 .active（由 openGalaxy 加）
  return (
    <div className="galaxy-overlay active" id="galaxyOverlay" ref={rootRef}>
      <div className="galaxy-header">
        <button className="galaxy-btn" id="galaxyCloseBtn" style={{ padding: '7px 13px' }} onClick={() => navigate(-1)}>✕</button>
        <div className="galaxy-seg">
          <button id="galaxySegRel" className="active">按关系</button>
          <button id="galaxySegCat">按分类</button>
        </div>
        <div className="galaxy-search-wrap"><input className="galaxy-search" id="galaxySearch" placeholder="搜索…" /></div>
        <button className="galaxy-btn on" id="galaxyEdgeBtn">连线</button>
      </div>
      <div className="galaxy-container" id="galaxyContainer">
        <svg className="galaxy-svg" id="galaxySvg"></svg>
        <div className="galaxy-tooltip" id="galaxyTooltip"></div>
        <div className="gx-banner" id="galaxyBanner"></div>
        <div className="gx-confirm" id="galaxyConfirm">
          <span className="gx-confirm-txt" id="galaxyConfirmTxt">拆掉这条藤?</span>
          <button className="gx-cbtn gx-cancel" id="galaxyCancel">算了</button>
          <button className="gx-cbtn gx-cdel" id="galaxyDel">拆掉</button>
        </div>
        <div className="gx-hint" id="galaxyHint"></div>
        <div className="gx-legend" id="galaxyLegend"></div>
      </div>
    </div>
  )
}
