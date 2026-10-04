(function () {
'use strict';

/*
 * Model import — brings 3D models from other programs into Blockbench: the geometry (as mesh elements), the textures (and the
 * colours of untextured materials), the skeleton and the animations.
 *
 *   OBJ (+MTL), FBX, glTF / GLB, Collada (DAE), 3DS, STL, PLY, 3MF, MD2, Half-Life MDL (GoldSrc), Quake MDL
 *
 * File > Import > 3D model. Pick the model, and (if they are not next to it) its textures, .mtl / .bin files too.
 *
 * A skeleton becomes:
 *   - bone groups, when every vertex follows one bone (Half-Life models, robots, most game props): each part moves with its bone;
 *   - an armature with vertex weights (Blockbench 5), when the skin bends smoothly between bones (characters from FBX / glTF).
 *     Without armatures (older Blockbench) such a skin is cut into parts that follow the bone they belong to most.
 * Every animation of the file becomes a Blockbench animation (sampled, then the keys that add nothing are left out).
 *
 * The loaders for the common formats are the three.js r129 examples (MIT, the same three.js Blockbench uses), kept apart from
 * Blockbench's own THREE. The MDL readers are written here from the published formats (studio.h of the Half-Life SDK, Quake's
 * modelgen.h).
 */

// ---------------------------------------------------------------------------
// three.js r129 loaders (MIT), in their own namespace
// ---------------------------------------------------------------------------

const fflate = (function () {
	// fflate is written to fit every module system: here it must simply hand itself over
	const module = undefined, exports = undefined, define = undefined, holder = {};
	const self = holder;   // eslint-disable-line no-unused-vars
/*!
fflate - fast JavaScript compression/decompression
<https://101arrowz.github.io/fflate>
Licensed under MIT. https://github.com/101arrowz/fflate/blob/master/LICENSE
version 0.6.9
*/
!function(f){typeof module!='undefined'&&typeof exports=='object'?module.exports=f():typeof define!='undefined'&&define.amd?define(['fflate',f]):(typeof self!='undefined'?self:this).fflate=f()}(function(){var _e={};"use strict";var t=(typeof module!='undefined'&&typeof exports=='object'?function(_f){"use strict";var e,t=";var __w=require('worker_threads');__w.parentPort.on('message',function(m){onmessage({data:m})}),postMessage=function(m,t){__w.parentPort.postMessage(m,t)},close=process.exit;self=global";try{e=require("worker_threads").Worker}catch(e){}exports.default=e?function(r,n,o,a,s){var u=!1,i=new e(r+t,{eval:!0}).on("error",(function(e){return s(e,null)})).on("message",(function(e){return s(null,e)})).on("exit",(function(e){e&&!u&&s(Error("exited with code "+e),null)}));return i.postMessage(o,a),i.terminate=function(){return u=!0,e.prototype.terminate.call(i)},i}:function(e,t,r,n,o){setImmediate((function(){return o(Error("async operations unsupported - update to Node 12+ (or Node 10-11 with the --experimental-worker CLI flag)"),null)}));var a=function(){};return{terminate:a,postMessage:a}};return _f}:function(_f){"use strict";var e={},r=function(e){return URL.createObjectURL(new Blob([e],{type:"text/javascript"}))},t=function(e){return new Worker(e)};try{URL.revokeObjectURL(r(""))}catch(e){r=function(e){return"data:application/javascript;charset=UTF-8,"+encodeURI(e)},t=function(e){return new Worker(e,{type:"module"})}}_f.default=function(n,o,u,a,c){var i=t(e[o]||(e[o]=r(n)));return i.onerror=function(e){return c(e.error,null)},i.onmessage=function(e){return c(null,e.data)},i.postMessage(u,a),i};return _f})({}),n=Uint8Array,r=Uint16Array,e=Uint32Array,i=new n([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),o=new n([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),a=new n([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),s=function(t,n){for(var i=new r(31),o=0;o<31;++o)i[o]=n+=1<<t[o-1];var a=new e(i[30]);for(o=1;o<30;++o)for(var s=i[o];s<i[o+1];++s)a[s]=s-i[o]<<5|o;return[i,a]},f=s(i,2),u=f[0],h=f[1];u[28]=258,h[258]=28;for(var c=s(o,0),l=c[0],p=c[1],v=new r(32768),d=0;d<32768;++d){var g=(43690&d)>>>1|(21845&d)<<1;v[d]=((65280&(g=(61680&(g=(52428&g)>>>2|(13107&g)<<2))>>>4|(3855&g)<<4))>>>8|(255&g)<<8)>>>1}var w=function(t,n,e){for(var i=t.length,o=0,a=new r(n);o<i;++o)++a[t[o]-1];var s,f=new r(n);for(o=0;o<n;++o)f[o]=f[o-1]+a[o-1]<<1;if(e){s=new r(1<<n);var u=15-n;for(o=0;o<i;++o)if(t[o])for(var h=o<<4|t[o],c=n-t[o],l=f[t[o]-1]++<<c,p=l|(1<<c)-1;l<=p;++l)s[v[l]>>>u]=h}else for(s=new r(i),o=0;o<i;++o)t[o]&&(s[o]=v[f[t[o]-1]++]>>>15-t[o]);return s},y=new n(288);for(d=0;d<144;++d)y[d]=8;for(d=144;d<256;++d)y[d]=9;for(d=256;d<280;++d)y[d]=7;for(d=280;d<288;++d)y[d]=8;var m=new n(32);for(d=0;d<32;++d)m[d]=5;var b=w(y,9,0),x=w(y,9,1),z=w(m,5,0),k=w(m,5,1),M=function(t){for(var n=t[0],r=1;r<t.length;++r)t[r]>n&&(n=t[r]);return n},A=function(t,n,r){var e=n/8|0;return(t[e]|t[e+1]<<8)>>(7&n)&r},S=function(t,n){var r=n/8|0;return(t[r]|t[r+1]<<8|t[r+2]<<16)>>(7&n)},D=function(t){return(t/8|0)+(7&t&&1)},C=function(t,i,o){(null==i||i<0)&&(i=0),(null==o||o>t.length)&&(o=t.length);var a=new(t instanceof r?r:t instanceof e?e:n)(o-i);return a.set(t.subarray(i,o)),a},U=function(t,r,e){var s=t.length;if(!s||e&&!e.l&&s<5)return r||new n(0);var f=!r||e,h=!e||e.i;e||(e={}),r||(r=new n(3*s));var c=function(t){var e=r.length;if(t>e){var i=new n(Math.max(2*e,t));i.set(r),r=i}},p=e.f||0,v=e.p||0,d=e.b||0,g=e.l,y=e.d,m=e.m,b=e.n,z=8*s;do{if(!g){e.f=p=A(t,v,1);var U=A(t,v+1,3);if(v+=3,!U){var O=t[(Y=D(v)+4)-4]|t[Y-3]<<8,T=Y+O;if(T>s){if(h)throw"unexpected EOF";break}f&&c(d+O),r.set(t.subarray(Y,T),d),e.b=d+=O,e.p=v=8*T;continue}if(1==U)g=x,y=k,m=9,b=5;else{if(2!=U)throw"invalid block type";var Z=A(t,v,31)+257,I=A(t,v+10,15)+4,F=Z+A(t,v+5,31)+1;v+=14;for(var E=new n(F),G=new n(19),P=0;P<I;++P)G[a[P]]=A(t,v+3*P,7);v+=3*I;var j=M(G),q=(1<<j)-1,H=w(G,j,1);for(P=0;P<F;){var Y,B=H[A(t,v,q)];if(v+=15&B,(Y=B>>>4)<16)E[P++]=Y;else{var J=0,K=0;for(16==Y?(K=3+A(t,v,3),v+=2,J=E[P-1]):17==Y?(K=3+A(t,v,7),v+=3):18==Y&&(K=11+A(t,v,127),v+=7);K--;)E[P++]=J}}var L=E.subarray(0,Z),N=E.subarray(Z);m=M(L),b=M(N),g=w(L,m,1),y=w(N,b,1)}if(v>z){if(h)throw"unexpected EOF";break}}f&&c(d+131072);for(var Q=(1<<m)-1,R=(1<<b)-1,V=v;;V=v){var W=(J=g[S(t,v)&Q])>>>4;if((v+=15&J)>z){if(h)throw"unexpected EOF";break}if(!J)throw"invalid length/literal";if(W<256)r[d++]=W;else{if(256==W){V=v,g=null;break}var X=W-254;W>264&&(X=A(t,v,(1<<(tt=i[P=W-257]))-1)+u[P],v+=tt);var $=y[S(t,v)&R],_=$>>>4;if(!$)throw"invalid distance";if(v+=15&$,N=l[_],_>3){var tt=o[_];N+=S(t,v)&(1<<tt)-1,v+=tt}if(v>z){if(h)throw"unexpected EOF";break}f&&c(d+131072);for(var nt=d+X;d<nt;d+=4)r[d]=r[d-N],r[d+1]=r[d+1-N],r[d+2]=r[d+2-N],r[d+3]=r[d+3-N];d=nt}}e.l=g,e.p=V,e.b=d,g&&(p=1,e.m=m,e.d=y,e.n=b)}while(!p);return d==r.length?r:C(r,0,d)},O=function(t,n,r){var e=n/8|0;t[e]|=r<<=7&n,t[e+1]|=r>>>8},T=function(t,n,r){var e=n/8|0;t[e]|=r<<=7&n,t[e+1]|=r>>>8,t[e+2]|=r>>>16},Z=function(t,e){for(var i=[],o=0;o<t.length;++o)t[o]&&i.push({s:o,f:t[o]});var a=i.length,s=i.slice();if(!a)return[q,0];if(1==a){var f=new n(i[0].s+1);return f[i[0].s]=1,[f,1]}i.sort((function(t,n){return t.f-n.f})),i.push({s:-1,f:25001});var u=i[0],h=i[1],c=0,l=1,p=2;for(i[0]={s:-1,f:u.f+h.f,l:u,r:h};l!=a-1;)u=i[i[c].f<i[p].f?c++:p++],h=i[c!=l&&i[c].f<i[p].f?c++:p++],i[l++]={s:-1,f:u.f+h.f,l:u,r:h};var v=s[0].s;for(o=1;o<a;++o)s[o].s>v&&(v=s[o].s);var d=new r(v+1),g=I(i[l-1],d,0);if(g>e){o=0;var w=0,y=g-e,m=1<<y;for(s.sort((function(t,n){return d[n.s]-d[t.s]||t.f-n.f}));o<a;++o){var b=s[o].s;if(!(d[b]>e))break;w+=m-(1<<g-d[b]),d[b]=e}for(w>>>=y;w>0;){var x=s[o].s;d[x]<e?w-=1<<e-d[x]++-1:++o}for(;o>=0&&w;--o){var z=s[o].s;d[z]==e&&(--d[z],++w)}g=e}return[new n(d),g]},I=function(t,n,r){return-1==t.s?Math.max(I(t.l,n,r+1),I(t.r,n,r+1)):n[t.s]=r},F=function(t){for(var n=t.length;n&&!t[--n];);for(var e=new r(++n),i=0,o=t[0],a=1,s=function(t){e[i++]=t},f=1;f<=n;++f)if(t[f]==o&&f!=n)++a;else{if(!o&&a>2){for(;a>138;a-=138)s(32754);a>2&&(s(a>10?a-11<<5|28690:a-3<<5|12305),a=0)}else if(a>3){for(s(o),--a;a>6;a-=6)s(8304);a>2&&(s(a-3<<5|8208),a=0)}for(;a--;)s(o);a=1,o=t[f]}return[e.subarray(0,i),n]},E=function(t,n){for(var r=0,e=0;e<n.length;++e)r+=t[e]*n[e];return r},G=function(t,n,r){var e=r.length,i=D(n+2);t[i]=255&e,t[i+1]=e>>>8,t[i+2]=255^t[i],t[i+3]=255^t[i+1];for(var o=0;o<e;++o)t[i+o+4]=r[o];return 8*(i+4+e)},P=function(t,n,e,s,f,u,h,c,l,p,v){O(n,v++,e),++f[256];for(var d=Z(f,15),g=d[0],x=d[1],k=Z(u,15),M=k[0],A=k[1],S=F(g),D=S[0],C=S[1],U=F(M),I=U[0],P=U[1],j=new r(19),q=0;q<D.length;++q)j[31&D[q]]++;for(q=0;q<I.length;++q)j[31&I[q]]++;for(var H=Z(j,7),Y=H[0],B=H[1],J=19;J>4&&!Y[a[J-1]];--J);var K,L,N,Q,R=p+5<<3,V=E(f,y)+E(u,m)+h,W=E(f,g)+E(u,M)+h+14+3*J+E(j,Y)+(2*j[16]+3*j[17]+7*j[18]);if(R<=V&&R<=W)return G(n,v,t.subarray(l,l+p));if(O(n,v,1+(W<V)),v+=2,W<V){K=w(g,x,0),L=g,N=w(M,A,0),Q=M;var X=w(Y,B,0);for(O(n,v,C-257),O(n,v+5,P-1),O(n,v+10,J-4),v+=14,q=0;q<J;++q)O(n,v+3*q,Y[a[q]]);v+=3*J;for(var $=[D,I],_=0;_<2;++_){var tt=$[_];for(q=0;q<tt.length;++q)O(n,v,X[nt=31&tt[q]]),v+=Y[nt],nt>15&&(O(n,v,tt[q]>>>5&127),v+=tt[q]>>>12)}}else K=b,L=y,N=z,Q=m;for(q=0;q<c;++q)if(s[q]>255){var nt;T(n,v,K[257+(nt=s[q]>>>18&31)]),v+=L[nt+257],nt>7&&(O(n,v,s[q]>>>23&31),v+=i[nt]);var rt=31&s[q];T(n,v,N[rt]),v+=Q[rt],rt>3&&(T(n,v,s[q]>>>5&8191),v+=o[rt])}else T(n,v,K[s[q]]),v+=L[s[q]];return T(n,v,K[256]),v+L[256]},j=new e([65540,131080,131088,131104,262176,1048704,1048832,2114560,2117632]),q=new n(0),H=function(t,a,s,f,u,c){var l=t.length,v=new n(f+l+5*(1+Math.ceil(l/7e3))+u),d=v.subarray(f,v.length-u),g=0;if(!a||l<8)for(var w=0;w<=l;w+=65535){var y=w+65535;y<l?g=G(d,g,t.subarray(w,y)):(d[w]=c,g=G(d,g,t.subarray(w,l)))}else{for(var m=j[a-1],b=m>>>13,x=8191&m,z=(1<<s)-1,k=new r(32768),M=new r(z+1),A=Math.ceil(s/3),S=2*A,U=function(n){return(t[n]^t[n+1]<<A^t[n+2]<<S)&z},O=new e(25e3),T=new r(288),Z=new r(32),I=0,F=0,E=(w=0,0),H=0,Y=0;w<l;++w){var B=U(w),J=32767&w,K=M[B];if(k[J]=K,M[B]=J,H<=w){var L=l-w;if((I>7e3||E>24576)&&L>423){g=P(t,d,0,O,T,Z,F,E,Y,w-Y,g),E=I=F=0,Y=w;for(var N=0;N<286;++N)T[N]=0;for(N=0;N<30;++N)Z[N]=0}var Q=2,R=0,V=x,W=J-K&32767;if(L>2&&B==U(w-W))for(var X=Math.min(b,L)-1,$=Math.min(32767,w),_=Math.min(258,L);W<=$&&--V&&J!=K;){if(t[w+Q]==t[w+Q-W]){for(var tt=0;tt<_&&t[w+tt]==t[w+tt-W];++tt);if(tt>Q){if(Q=tt,R=W,tt>X)break;var nt=Math.min(W,tt-2),rt=0;for(N=0;N<nt;++N){var et=w-W+N+32768&32767,it=et-k[et]+32768&32767;it>rt&&(rt=it,K=et)}}}W+=(J=K)-(K=k[J])+32768&32767}if(R){O[E++]=268435456|h[Q]<<18|p[R];var ot=31&h[Q],at=31&p[R];F+=i[ot]+o[at],++T[257+ot],++Z[at],H=w+Q,++I}else O[E++]=t[w],++T[t[w]]}}g=P(t,d,c,O,T,Z,F,E,Y,w-Y,g),!c&&7&g&&(g=G(d,g+1,q))}return C(v,0,f+D(g)+u)},Y=function(){for(var t=new e(256),n=0;n<256;++n){for(var r=n,i=9;--i;)r=(1&r&&3988292384)^r>>>1;t[n]=r}return t}(),B=function(){var t=-1;return{p:function(n){for(var r=t,e=0;e<n.length;++e)r=Y[255&r^n[e]]^r>>>8;t=r},d:function(){return~t}}},J=function(){var t=1,n=0;return{p:function(r){for(var e=t,i=n,o=r.length,a=0;a!=o;){for(var s=Math.min(a+2655,o);a<s;++a)i+=e+=r[a];e=(65535&e)+15*(e>>16),i=(65535&i)+15*(i>>16)}t=e,n=i},d:function(){return(255&(t%=65521))<<24|t>>>8<<16|(255&(n%=65521))<<8|n>>>8}}},K=function(t,n,r,e,i){return H(t,null==n.level?6:n.level,null==n.mem?Math.ceil(1.5*Math.max(8,Math.min(13,Math.log(t.length)))):12+n.mem,r,e,!i)},L=function(t,n){var r={};for(var e in t)r[e]=t[e];for(var e in n)r[e]=n[e];return r},N=function(t,n,r){for(var e=t(),i=""+t,o=i.slice(i.indexOf("[")+1,i.lastIndexOf("]")).replace(/ /g,"").split(","),a=0;a<e.length;++a){var s=e[a],f=o[a];if("function"==typeof s){n+=";"+f+"=";var u=""+s;if(s.prototype)if(-1!=u.indexOf("[native code]")){var h=u.indexOf(" ",8)+1;n+=u.slice(h,u.indexOf("(",h))}else for(var c in n+=u,s.prototype)n+=";"+f+".prototype."+c+"="+s.prototype[c];else n+=u}else r[f]=s}return[n,r]},Q=[],R=function(t){var i=[];for(var o in t)(t[o]instanceof n||t[o]instanceof r||t[o]instanceof e)&&i.push((t[o]=new t[o].constructor(t[o])).buffer);return i},V=function(n,r,e,i){var o;if(!Q[e]){for(var a="",s={},f=n.length-1,u=0;u<f;++u)a=(o=N(n[u],a,s))[0],s=o[1];Q[e]=N(n[f],a,s)}var h=L({},Q[e][1]);return t.default(Q[e][0]+";onmessage=function(e){for(var k in e.data)self[k]=e.data[k];onmessage="+r+"}",e,h,R(h),i)},W=function(){return[n,r,e,i,o,a,u,l,x,k,v,w,M,A,S,D,C,U,At,rt,et]},X=function(){return[n,r,e,i,o,a,h,p,b,y,z,m,v,j,q,w,O,T,Z,I,F,E,G,P,D,C,H,K,xt,rt]},$=function(){return[ct,vt,ht,B,Y]},_=function(){return[lt,pt]},tt=function(){return[dt,ht,J]},nt=function(){return[gt]},rt=function(t){return postMessage(t,[t.buffer])},et=function(t){return t&&t.size&&new n(t.size)},it=function(t,n,r,e,i,o){var a=V(r,e,i,(function(t,n){a.terminate(),o(t,n)}));return a.postMessage([t,n],n.consume?[t.buffer]:[]),function(){a.terminate()}},ot=function(t){return t.ondata=function(t,n){return postMessage([t,n],[t.buffer])},function(n){return t.push(n.data[0],n.data[1])}},at=function(t,n,r,e,i){var o,a=V(t,e,i,(function(t,r){t?(a.terminate(),n.ondata.call(n,t)):(r[1]&&a.terminate(),n.ondata.call(n,t,r[0],r[1]))}));a.postMessage(r),n.push=function(t,r){if(o)throw"stream finished";if(!n.ondata)throw"no stream handler";a.postMessage([t,o=r],[t.buffer])},n.terminate=function(){a.terminate()}},st=function(t,n){return t[n]|t[n+1]<<8},ft=function(t,n){return(t[n]|t[n+1]<<8|t[n+2]<<16|t[n+3]<<24)>>>0},ut=function(t,n){return ft(t,n)+4294967296*ft(t,n+4)},ht=function(t,n,r){for(;r;++n)t[n]=r,r>>>=8},ct=function(t,n){var r=n.filename;if(t[0]=31,t[1]=139,t[2]=8,t[8]=n.level<2?4:9==n.level?2:0,t[9]=3,0!=n.mtime&&ht(t,4,Math.floor(new Date(n.mtime||Date.now())/1e3)),r){t[3]=8;for(var e=0;e<=r.length;++e)t[e+10]=r.charCodeAt(e)}},lt=function(t){if(31!=t[0]||139!=t[1]||8!=t[2])throw"invalid gzip data";var n=t[3],r=10;4&n&&(r+=t[10]|2+(t[11]<<8));for(var e=(n>>3&1)+(n>>4&1);e>0;e-=!t[r++]);return r+(2&n)},pt=function(t){var n=t.length;return(t[n-4]|t[n-3]<<8|t[n-2]<<16|t[n-1]<<24)>>>0},vt=function(t){return 10+(t.filename&&t.filename.length+1||0)},dt=function(t,n){var r=n.level,e=0==r?0:r<6?1:9==r?3:2;t[0]=120,t[1]=e<<6|(e?32-2*e:1)},gt=function(t){if(8!=(15&t[0])||t[0]>>>4>7||(t[0]<<8|t[1])%31)throw"invalid zlib data";if(32&t[1])throw"invalid zlib data: preset dictionaries not supported"};function wt(t,n){return n||"function"!=typeof t||(n=t,t={}),this.ondata=n,t}var yt=function(){function t(t,n){n||"function"!=typeof t||(n=t,t={}),this.ondata=n,this.o=t||{}}return t.prototype.p=function(t,n){this.ondata(K(t,this.o,0,0,!n),n)},t.prototype.push=function(t,n){if(this.d)throw"stream finished";if(!this.ondata)throw"no stream handler";this.d=n,this.p(t,n||!1)},t}();_e.Deflate=yt;var mt=function(){return function(t,n){at([X,function(){return[ot,yt]}],this,wt.call(this,t,n),(function(t){var n=new yt(t.data);onmessage=ot(n)}),6)}}();function bt(t,n,r){if(r||(r=n,n={}),"function"!=typeof r)throw"no callback";return it(t,n,[X],(function(t){return rt(xt(t.data[0],t.data[1]))}),0,r)}function xt(t,n){return K(t,n||{},0,0)}_e.AsyncDeflate=mt,_e.deflate=bt,_e.deflateSync=xt;var zt=function(){function t(t){this.s={},this.p=new n(0),this.ondata=t}return t.prototype.e=function(t){if(this.d)throw"stream finished";if(!this.ondata)throw"no stream handler";var r=this.p.length,e=new n(r+t.length);e.set(this.p),e.set(t,r),this.p=e},t.prototype.c=function(t){this.d=this.s.i=t||!1;var n=this.s.b,r=U(this.p,this.o,this.s);this.ondata(C(r,n,this.s.b),this.d),this.o=C(r,this.s.b-32768),this.s.b=this.o.length,this.p=C(this.p,this.s.p/8|0),this.s.p&=7},t.prototype.push=function(t,n){this.e(t),this.c(n)},t}();_e.Inflate=zt;var kt=function(){return function(t){this.ondata=t,at([W,function(){return[ot,zt]}],this,0,(function(){var t=new zt;onmessage=ot(t)}),7)}}();function Mt(t,n,r){if(r||(r=n,n={}),"function"!=typeof r)throw"no callback";return it(t,n,[W],(function(t){return rt(At(t.data[0],et(t.data[1])))}),1,r)}function At(t,n){return U(t,n)}_e.AsyncInflate=kt,_e.inflate=Mt,_e.inflateSync=At;var St=function(){function t(t,n){this.c=B(),this.l=0,this.v=1,yt.call(this,t,n)}return t.prototype.push=function(t,n){yt.prototype.push.call(this,t,n)},t.prototype.p=function(t,n){this.c.p(t),this.l+=t.length;var r=K(t,this.o,this.v&&vt(this.o),n&&8,!n);this.v&&(ct(r,this.o),this.v=0),n&&(ht(r,r.length-8,this.c.d()),ht(r,r.length-4,this.l)),this.ondata(r,n)},t}();_e.Gzip=St,_e.Compress=St;var Dt=function(){return function(t,n){at([X,$,function(){return[ot,yt,St]}],this,wt.call(this,t,n),(function(t){var n=new St(t.data);onmessage=ot(n)}),8)}}();function Ct(t,n,r){if(r||(r=n,n={}),"function"!=typeof r)throw"no callback";return it(t,n,[X,$,function(){return[Ut]}],(function(t){return rt(Ut(t.data[0],t.data[1]))}),2,r)}function Ut(t,n){n||(n={});var r=B(),e=t.length;r.p(t);var i=K(t,n,vt(n),8),o=i.length;return ct(i,n),ht(i,o-8,r.d()),ht(i,o-4,e),i}_e.AsyncGzip=Dt,_e.AsyncCompress=Dt,_e.gzip=Ct,_e.compress=Ct,_e.gzipSync=Ut,_e.compressSync=Ut;var Ot=function(){function t(t){this.v=1,zt.call(this,t)}return t.prototype.push=function(t,n){if(zt.prototype.e.call(this,t),this.v){var r=this.p.length>3?lt(this.p):4;if(r>=this.p.length&&!n)return;this.p=this.p.subarray(r),this.v=0}if(n){if(this.p.length<8)throw"invalid gzip stream";this.p=this.p.subarray(0,-8)}zt.prototype.c.call(this,n)},t}();_e.Gunzip=Ot;var Tt=function(){return function(t){this.ondata=t,at([W,_,function(){return[ot,zt,Ot]}],this,0,(function(){var t=new Ot;onmessage=ot(t)}),9)}}();function Zt(t,n,r){if(r||(r=n,n={}),"function"!=typeof r)throw"no callback";return it(t,n,[W,_,function(){return[It]}],(function(t){return rt(It(t.data[0]))}),3,r)}function It(t,r){return U(t.subarray(lt(t),-8),r||new n(pt(t)))}_e.AsyncGunzip=Tt,_e.gunzip=Zt,_e.gunzipSync=It;var Ft=function(){function t(t,n){this.c=J(),this.v=1,yt.call(this,t,n)}return t.prototype.push=function(t,n){yt.prototype.push.call(this,t,n)},t.prototype.p=function(t,n){this.c.p(t);var r=K(t,this.o,this.v&&2,n&&4,!n);this.v&&(dt(r,this.o),this.v=0),n&&ht(r,r.length-4,this.c.d()),this.ondata(r,n)},t}();_e.Zlib=Ft;var Et=function(){return function(t,n){at([X,tt,function(){return[ot,yt,Ft]}],this,wt.call(this,t,n),(function(t){var n=new Ft(t.data);onmessage=ot(n)}),10)}}();function Gt(t,n,r){if(r||(r=n,n={}),"function"!=typeof r)throw"no callback";return it(t,n,[X,tt,function(){return[Pt]}],(function(t){return rt(Pt(t.data[0],t.data[1]))}),4,r)}function Pt(t,n){n||(n={});var r=J();r.p(t);var e=K(t,n,2,4);return dt(e,n),ht(e,e.length-4,r.d()),e}_e.AsyncZlib=Et,_e.zlib=Gt,_e.zlibSync=Pt;var jt=function(){function t(t){this.v=1,zt.call(this,t)}return t.prototype.push=function(t,n){if(zt.prototype.e.call(this,t),this.v){if(this.p.length<2&&!n)return;this.p=this.p.subarray(2),this.v=0}if(n){if(this.p.length<4)throw"invalid zlib stream";this.p=this.p.subarray(0,-4)}zt.prototype.c.call(this,n)},t}();_e.Unzlib=jt;var qt=function(){return function(t){this.ondata=t,at([W,nt,function(){return[ot,zt,jt]}],this,0,(function(){var t=new jt;onmessage=ot(t)}),11)}}();function Ht(t,n,r){if(r||(r=n,n={}),"function"!=typeof r)throw"no callback";return it(t,n,[W,nt,function(){return[Yt]}],(function(t){return rt(Yt(t.data[0],et(t.data[1])))}),5,r)}function Yt(t,n){return U((gt(t),t.subarray(2,-4)),n)}_e.AsyncUnzlib=qt,_e.unzlib=Ht,_e.unzlibSync=Yt;var Bt=function(){function t(t){this.G=Ot,this.I=zt,this.Z=jt,this.ondata=t}return t.prototype.push=function(t,r){if(!this.ondata)throw"no stream handler";if(this.s)this.s.push(t,r);else{if(this.p&&this.p.length){var e=new n(this.p.length+t.length);e.set(this.p),e.set(t,this.p.length)}else this.p=t;if(this.p.length>2){var i=this,o=function(){i.ondata.apply(i,arguments)};this.s=31==this.p[0]&&139==this.p[1]&&8==this.p[2]?new this.G(o):8!=(15&this.p[0])||this.p[0]>>4>7||(this.p[0]<<8|this.p[1])%31?new this.I(o):new this.Z(o),this.s.push(this.p,r),this.p=null}}},t}();_e.Decompress=Bt;var Jt=function(){function t(t){this.G=Tt,this.I=kt,this.Z=qt,this.ondata=t}return t.prototype.push=function(t,n){Bt.prototype.push.call(this,t,n)},t}();function Kt(t,n,r){if(r||(r=n,n={}),"function"!=typeof r)throw"no callback";return 31==t[0]&&139==t[1]&&8==t[2]?Zt(t,n,r):8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31?Mt(t,n,r):Ht(t,n,r)}function Lt(t,n){return 31==t[0]&&139==t[1]&&8==t[2]?It(t,n):8!=(15&t[0])||t[0]>>4>7||(t[0]<<8|t[1])%31?At(t,n):Yt(t,n)}_e.AsyncDecompress=Jt,_e.decompress=Kt,_e.decompressSync=Lt;var Nt=function(t,r,e,i){for(var o in t){var a=t[o],s=r+o;a instanceof n?e[s]=[a,i]:Array.isArray(a)?e[s]=[a[0],L(i,a[1])]:Nt(a,s+"/",e,i)}},Qt="undefined"!=typeof TextEncoder&&new TextEncoder,Rt="undefined"!=typeof TextDecoder&&new TextDecoder,Vt=0;try{Rt.decode(q,{stream:!0}),Vt=1}catch(t){}var Wt=function(t){for(var n="",r=0;;){var e=t[r++],i=(e>127)+(e>223)+(e>239);if(r+i>t.length)return[n,C(t,r-1)];i?3==i?(e=((15&e)<<18|(63&t[r++])<<12|(63&t[r++])<<6|63&t[r++])-65536,n+=String.fromCharCode(55296|e>>10,56320|1023&e)):n+=String.fromCharCode(1&i?(31&e)<<6|63&t[r++]:(15&e)<<12|(63&t[r++])<<6|63&t[r++]):n+=String.fromCharCode(e)}},Xt=function(){function t(t){this.ondata=t,Vt?this.t=new TextDecoder:this.p=q}return t.prototype.push=function(t,r){if(!this.ondata)throw"no callback";if(r=!!r,this.t){if(this.ondata(this.t.decode(t,{stream:!0}),r),r){if(this.t.decode().length)throw"invalid utf-8 data";this.t=null}}else{if(!this.p)throw"stream finished";var e=new n(this.p.length+t.length);e.set(this.p),e.set(t,this.p.length);var i=Wt(e),o=i[0],a=i[1];if(r){if(a.length)throw"invalid utf-8 data";this.p=null}else this.p=a;this.ondata(o,r)}},t}();_e.DecodeUTF8=Xt;var $t=function(){function t(t){this.ondata=t}return t.prototype.push=function(t,n){if(!this.ondata)throw"no callback";if(this.d)throw"stream finished";this.ondata(_t(t),this.d=n||!1)},t}();function _t(t,r){if(r){for(var e=new n(t.length),i=0;i<t.length;++i)e[i]=t.charCodeAt(i);return e}if(Qt)return Qt.encode(t);var o=t.length,a=new n(t.length+(t.length>>1)),s=0,f=function(t){a[s++]=t};for(i=0;i<o;++i){if(s+5>a.length){var u=new n(s+8+(o-i<<1));u.set(a),a=u}var h=t.charCodeAt(i);h<128||r?f(h):h<2048?(f(192|h>>6),f(128|63&h)):h>55295&&h<57344?(f(240|(h=65536+(1047552&h)|1023&t.charCodeAt(++i))>>18),f(128|h>>12&63),f(128|h>>6&63),f(128|63&h)):(f(224|h>>12),f(128|h>>6&63),f(128|63&h))}return C(a,0,s)}function tn(t,n){if(n){for(var r="",e=0;e<t.length;e+=16384)r+=String.fromCharCode.apply(null,t.subarray(e,e+16384));return r}if(Rt)return Rt.decode(t);var i=Wt(t);if(i[1].length)throw"invalid utf-8 data";return i[0]}_e.EncodeUTF8=$t,_e.strToU8=_t,_e.strFromU8=tn;var nn=function(t){return 1==t?3:t<6?2:9==t?1:0},rn=function(t,n){return n+30+st(t,n+26)+st(t,n+28)},en=function(t,n,r){var e=st(t,n+28),i=tn(t.subarray(n+46,n+46+e),!(2048&st(t,n+8))),o=n+46+e,a=ft(t,n+20),s=r&&4294967295==a?on(t,o):[a,ft(t,n+24),ft(t,n+42)],f=s[0],u=s[1],h=s[2];return[st(t,n+10),f,u,i,o+st(t,n+30)+st(t,n+32),h]},on=function(t,n){for(;1!=st(t,n);n+=4+st(t,n+2));return[ut(t,n+12),ut(t,n+4),ut(t,n+20)]},an=function(t){var n=0;if(t)for(var r in t){var e=t[r].length;if(e>65535)throw"extra field too long";n+=e+4}return n},sn=function(t,n,r,e,i,o,a,s){var f=e.length,u=r.extra,h=s&&s.length,c=an(u);ht(t,n,null!=a?33639248:67324752),n+=4,null!=a&&(t[n++]=20,t[n++]=r.os),t[n]=20,n+=2,t[n++]=r.flag<<1|(null==o&&8),t[n++]=i&&8,t[n++]=255&r.compression,t[n++]=r.compression>>8;var l=new Date(null==r.mtime?Date.now():r.mtime),p=l.getFullYear()-1980;if(p<0||p>119)throw"date not in range 1980-2099";if(ht(t,n,p<<25|l.getMonth()+1<<21|l.getDate()<<16|l.getHours()<<11|l.getMinutes()<<5|l.getSeconds()>>>1),n+=4,null!=o&&(ht(t,n,r.crc),ht(t,n+4,o),ht(t,n+8,r.size)),ht(t,n+12,f),ht(t,n+14,c),n+=16,null!=a&&(ht(t,n,h),ht(t,n+6,r.attrs),ht(t,n+10,a),n+=14),t.set(e,n),n+=f,c)for(var v in u){var d=u[v],g=d.length;ht(t,n,+v),ht(t,n+2,g),t.set(d,n+4),n+=4+g}return h&&(t.set(s,n),n+=h),n},fn=function(t,n,r,e,i){ht(t,n,101010256),ht(t,n+8,r),ht(t,n+10,r),ht(t,n+12,e),ht(t,n+16,i)},un=function(){function t(t){this.filename=t,this.c=B(),this.size=0,this.compression=0}return t.prototype.process=function(t,n){this.ondata(null,t,n)},t.prototype.push=function(t,n){if(!this.ondata)throw"no callback - add to ZIP archive before pushing";this.c.p(t),this.size+=t.length,n&&(this.crc=this.c.d()),this.process(t,n||!1)},t}();_e.ZipPassThrough=un;var hn=function(){function t(t,n){var r=this;n||(n={}),un.call(this,t),this.d=new yt(n,(function(t,n){r.ondata(null,t,n)})),this.compression=8,this.flag=nn(n.level)}return t.prototype.process=function(t,n){try{this.d.push(t,n)}catch(t){this.ondata(t,null,n)}},t.prototype.push=function(t,n){un.prototype.push.call(this,t,n)},t}();_e.ZipDeflate=hn;var cn=function(){function t(t,n){var r=this;n||(n={}),un.call(this,t),this.d=new mt(n,(function(t,n,e){r.ondata(t,n,e)})),this.compression=8,this.flag=nn(n.level),this.terminate=this.d.terminate}return t.prototype.process=function(t,n){this.d.push(t,n)},t.prototype.push=function(t,n){un.prototype.push.call(this,t,n)},t}();_e.AsyncZipDeflate=cn;var ln=function(){function t(t){this.ondata=t,this.u=[],this.d=1}return t.prototype.add=function(t){var r=this;if(2&this.d)throw"stream finished";var e=_t(t.filename),i=e.length,o=t.comment,a=o&&_t(o),s=i!=t.filename.length||a&&o.length!=a.length,f=i+an(t.extra)+30;if(i>65535)throw"filename too long";var u=new n(f);sn(u,0,t,e,s);var h=[u],c=function(){for(var t=0,n=h;t<n.length;t++)r.ondata(null,n[t],!1);h=[]},l=this.d;this.d=0;var p=this.u.length,v=L(t,{f:e,u:s,o:a,t:function(){t.terminate&&t.terminate()},r:function(){if(c(),l){var t=r.u[p+1];t?t.r():r.d=1}l=1}}),d=0;t.ondata=function(e,i,o){if(e)r.ondata(e,i,o),r.terminate();else if(d+=i.length,h.push(i),o){var a=new n(16);ht(a,0,134695760),ht(a,4,t.crc),ht(a,8,d),ht(a,12,t.size),h.push(a),v.c=d,v.b=f+d+16,v.crc=t.crc,v.size=t.size,l&&v.r(),l=1}else l&&c()},this.u.push(v)},t.prototype.end=function(){var t=this;if(2&this.d){if(1&this.d)throw"stream finishing";throw"stream finished"}this.d?this.e():this.u.push({r:function(){1&t.d&&(t.u.splice(-1,1),t.e())},t:function(){}}),this.d=3},t.prototype.e=function(){for(var t=0,r=0,e=0,i=0,o=this.u;i<o.length;i++)e+=46+(u=o[i]).f.length+an(u.extra)+(u.o?u.o.length:0);for(var a=new n(e+22),s=0,f=this.u;s<f.length;s++){var u;sn(a,t,u=f[s],u.f,u.u,u.c,r,u.o),t+=46+u.f.length+an(u.extra)+(u.o?u.o.length:0),r+=u.b}fn(a,t,this.u.length,e,r),this.ondata(null,a,!0),this.d=2},t.prototype.terminate=function(){for(var t=0,n=this.u;t<n.length;t++)n[t].t();this.d=2},t}();function pn(t,r,e){if(e||(e=r,r={}),"function"!=typeof e)throw"no callback";var i={};Nt(t,"",i,r);var o=Object.keys(i),a=o.length,s=0,f=0,u=a,h=Array(a),c=[],l=function(){for(var t=0;t<c.length;++t)c[t]()},p=function(){var t=new n(f+22),r=s,i=f-s;f=0;for(var o=0;o<u;++o){var a=h[o];try{var c=a.c.length;sn(t,f,a,a.f,a.u,c);var l=30+a.f.length+an(a.extra),p=f+l;t.set(a.c,p),sn(t,s,a,a.f,a.u,c,f,a.m),s+=16+l+(a.m?a.m.length:0),f=p+c}catch(t){return e(t,null)}}fn(t,s,h.length,i,r),e(null,t)};a||p();for(var v=function(t){var n=o[t],r=i[n],u=r[0],v=r[1],d=B(),g=u.length;d.p(u);var w=_t(n),y=w.length,m=v.comment,b=m&&_t(m),x=b&&b.length,z=an(v.extra),k=0==v.level?0:8,M=function(r,i){if(r)l(),e(r,null);else{var o=i.length;h[t]=L(v,{size:g,crc:d.d(),c:i,f:w,m:b,u:y!=n.length||b&&m.length!=x,compression:k}),s+=30+y+z+o,f+=76+2*(y+z)+(x||0)+o,--a||p()}};if(y>65535&&M("filename too long",null),k)if(g<16e4)try{M(null,xt(u,v))}catch(t){M(t,null)}else c.push(bt(u,v,M));else M(null,u)},d=0;d<u;++d)v(d);return l}function vn(t,r){r||(r={});var e={},i=[];Nt(t,"",e,r);var o=0,a=0;for(var s in e){var f=e[s],u=f[0],h=f[1],c=0==h.level?0:8,l=(M=_t(s)).length,p=h.comment,v=p&&_t(p),d=v&&v.length,g=an(h.extra);if(l>65535)throw"filename too long";var w=c?xt(u,h):u,y=w.length,m=B();m.p(u),i.push(L(h,{size:u.length,crc:m.d(),c:w,f:M,m:v,u:l!=s.length||v&&p.length!=d,o:o,compression:c})),o+=30+l+g+y,a+=76+2*(l+g)+(d||0)+y}for(var b=new n(a+22),x=o,z=a-o,k=0;k<i.length;++k){var M;sn(b,(M=i[k]).o,M,M.f,M.u,M.c.length);var A=30+M.f.length+an(M.extra);b.set(M.c,M.o+A),sn(b,o,M,M.f,M.u,M.c.length,M.o,M.m),o+=16+A+(M.m?M.m.length:0)}return fn(b,o,i.length,z,x),b}_e.Zip=ln,_e.zip=pn,_e.zipSync=vn;var dn=function(){function t(){}return t.prototype.push=function(t,n){this.ondata(null,t,n)},t.compression=0,t}();_e.UnzipPassThrough=dn;var gn=function(){function t(){var t=this;this.i=new zt((function(n,r){t.ondata(null,n,r)}))}return t.prototype.push=function(t,n){try{this.i.push(t,n)}catch(r){this.ondata(r,t,n)}},t.compression=8,t}();_e.UnzipInflate=gn;var wn=function(){function t(t,n){var r=this;n<32e4?this.i=new zt((function(t,n){r.ondata(null,t,n)})):(this.i=new kt((function(t,n,e){r.ondata(t,n,e)})),this.terminate=this.i.terminate)}return t.prototype.push=function(t,n){this.i.terminate&&(t=C(t,0)),this.i.push(t,n)},t.compression=8,t}();_e.AsyncUnzipInflate=wn;var yn=function(){function t(t){this.onfile=t,this.k=[],this.o={0:dn},this.p=q}return t.prototype.push=function(t,r){var e=this;if(!this.onfile)throw"no callback";if(!this.p)throw"stream finished";if(this.c>0){var i=Math.min(this.c,t.length),o=t.subarray(0,i);if(this.c-=i,this.d?this.d.push(o,!this.c):this.k[0].push(o),(t=t.subarray(i)).length)return this.push(t,r)}else{var a=0,s=0,f=void 0,u=void 0;this.p.length?t.length?((u=new n(this.p.length+t.length)).set(this.p),u.set(t,this.p.length)):u=this.p:u=t;for(var h=u.length,c=this.c,l=c&&this.d,p=function(){var t,n=ft(u,s);if(67324752==n){a=1,f=s,v.d=null,v.c=0;var r=st(u,s+6),i=st(u,s+8),o=2048&r,l=8&r,p=st(u,s+26),d=st(u,s+28);if(h>s+30+p+d){var g=[];v.k.unshift(g),a=2;var w,y=ft(u,s+18),m=ft(u,s+22),b=tn(u.subarray(s+30,s+=30+p),!o);4294967295==y?(t=l?[-2]:on(u,s),y=t[0],m=t[1]):l&&(y=-1),s+=d,v.c=y;var x={name:b,compression:i,start:function(){if(!x.ondata)throw"no callback";if(y){var t=e.o[i];if(!t)throw"unknown compression type "+i;(w=y<0?new t(b):new t(b,y,m)).ondata=function(t,n,r){x.ondata(t,n,r)};for(var n=0,r=g;n<r.length;n++)w.push(r[n],!1);e.k[0]==g&&e.c?e.d=w:w.push(q,!0)}else x.ondata(null,q,!0)},terminate:function(){w&&w.terminate&&w.terminate()}};y>=0&&(x.size=y,x.originalSize=m),v.onfile(x)}return"break"}if(c){if(134695760==n)return f=s+=12+(-2==c&&8),a=3,v.c=0,"break";if(33639248==n)return f=s-=4,a=3,v.c=0,"break"}},v=this;s<h-4&&"break"!==p();++s);if(this.p=q,c<0){var d=u.subarray(0,a?f-12-(-2==c&&8)-(134695760==ft(u,f-16)&&4):s);l?l.push(d,!!a):this.k[+(2==a)].push(d)}if(2&a)return this.push(u.subarray(s),r);this.p=u.subarray(s)}if(r){if(this.c)throw"invalid zip file";this.p=null}},t.prototype.register=function(t){this.o[t.compression]=t},t}();function mn(t,r){if("function"!=typeof r)throw"no callback";for(var e=[],i=function(){for(var t=0;t<e.length;++t)e[t]()},o={},a=t.length-22;101010256!=ft(t,a);--a)if(!a||t.length-a>65558)return void r("invalid zip file",null);var s=st(t,a+8);s||r(null,{});var f=s,u=ft(t,a+16),h=4294967295==u;if(h){if(a=ft(t,a-12),101075792!=ft(t,a))return void r("invalid zip file",null);f=s=ft(t,a+32),u=ft(t,a+48)}for(var c=function(a){var f=en(t,u,h),c=f[0],l=f[1],p=f[2],v=f[3],d=f[4],g=rn(t,f[5]);u=d;var w=function(t,n){t?(i(),r(t,null)):(o[v]=n,--s||r(null,o))};if(c)if(8==c){var y=t.subarray(g,g+l);if(l<32e4)try{w(null,At(y,new n(p)))}catch(t){w(t,null)}else e.push(Mt(y,{size:p},w))}else w("unknown compression type "+c,null);else w(null,C(t,g,g+l))},l=0;l<f;++l)c();return i}function bn(t){for(var r={},e=t.length-22;101010256!=ft(t,e);--e)if(!e||t.length-e>65558)throw"invalid zip file";var i=st(t,e+8);if(!i)return{};var o=ft(t,e+16),a=4294967295==o;if(a){if(e=ft(t,e-12),101075792!=ft(t,e))throw"invalid zip file";i=ft(t,e+32),o=ft(t,e+48)}for(var s=0;s<i;++s){var f=en(t,o,a),u=f[0],h=f[1],c=f[2],l=f[3],p=f[4],v=rn(t,f[5]);if(o=p,u){if(8!=u)throw"unknown compression type "+u;r[l]=At(t.subarray(v,v+h),new n(c))}else r[l]=C(t,v,v+h)}return r}_e.Unzip=yn,_e.unzip=mn,_e.unzipSync=bn;return _e})

	return holder.fflate;
})();

const L = (function (THREE_GLOBAL) {
	const THREE = Object.create(THREE_GLOBAL);
( function () {

	/**
 * NURBS utils
 *
 * See NURBSCurve and NURBSSurface.
 **/

	/**************************************************************
 *	NURBS Utils
 **************************************************************/

	class NURBSUtils {

		/*
  Finds knot vector span.
  	p : degree
  u : parametric value
  U : knot vector
  	returns the span
  */
		static findSpan( p, u, U ) {

			const n = U.length - p - 1;

			if ( u >= U[ n ] ) {

				return n - 1;

			}

			if ( u <= U[ p ] ) {

				return p;

			}

			let low = p;
			let high = n;
			let mid = Math.floor( ( low + high ) / 2 );

			while ( u < U[ mid ] || u >= U[ mid + 1 ] ) {

				if ( u < U[ mid ] ) {

					high = mid;

				} else {

					low = mid;

				}

				mid = Math.floor( ( low + high ) / 2 );

			}

			return mid;

		}
		/*
  Calculate basis functions. See The NURBS Book, page 70, algorithm A2.2
  	span : span in which u lies
  u    : parametric point
  p    : degree
  U    : knot vector
  	returns array[p+1] with basis functions values.
  */


		static calcBasisFunctions( span, u, p, U ) {

			const N = [];
			const left = [];
			const right = [];
			N[ 0 ] = 1.0;

			for ( let j = 1; j <= p; ++ j ) {

				left[ j ] = u - U[ span + 1 - j ];
				right[ j ] = U[ span + j ] - u;
				let saved = 0.0;

				for ( let r = 0; r < j; ++ r ) {

					const rv = right[ r + 1 ];
					const lv = left[ j - r ];
					const temp = N[ r ] / ( rv + lv );
					N[ r ] = saved + rv * temp;
					saved = lv * temp;

				}

				N[ j ] = saved;

			}

			return N;

		}
		/*
  Calculate B-Spline curve points. See The NURBS Book, page 82, algorithm A3.1.
  	p : degree of B-Spline
  U : knot vector
  P : control points (x, y, z, w)
  u : parametric point
  	returns point for given u
  */


		static calcBSplinePoint( p, U, P, u ) {

			const span = this.findSpan( p, u, U );
			const N = this.calcBasisFunctions( span, u, p, U );
			const C = new THREE.Vector4( 0, 0, 0, 0 );

			for ( let j = 0; j <= p; ++ j ) {

				const point = P[ span - p + j ];
				const Nj = N[ j ];
				const wNj = point.w * Nj;
				C.x += point.x * wNj;
				C.y += point.y * wNj;
				C.z += point.z * wNj;
				C.w += point.w * Nj;

			}

			return C;

		}
		/*
  Calculate basis functions derivatives. See The NURBS Book, page 72, algorithm A2.3.
  	span : span in which u lies
  u    : parametric point
  p    : degree
  n    : number of derivatives to calculate
  U    : knot vector
  	returns array[n+1][p+1] with basis functions derivatives
  */


		static calcBasisFunctionDerivatives( span, u, p, n, U ) {

			const zeroArr = [];

			for ( let i = 0; i <= p; ++ i ) zeroArr[ i ] = 0.0;

			const ders = [];

			for ( let i = 0; i <= n; ++ i ) ders[ i ] = zeroArr.slice( 0 );

			const ndu = [];

			for ( let i = 0; i <= p; ++ i ) ndu[ i ] = zeroArr.slice( 0 );

			ndu[ 0 ][ 0 ] = 1.0;
			const left = zeroArr.slice( 0 );
			const right = zeroArr.slice( 0 );

			for ( let j = 1; j <= p; ++ j ) {

				left[ j ] = u - U[ span + 1 - j ];
				right[ j ] = U[ span + j ] - u;
				let saved = 0.0;

				for ( let r = 0; r < j; ++ r ) {

					const rv = right[ r + 1 ];
					const lv = left[ j - r ];
					ndu[ j ][ r ] = rv + lv;
					const temp = ndu[ r ][ j - 1 ] / ndu[ j ][ r ];
					ndu[ r ][ j ] = saved + rv * temp;
					saved = lv * temp;

				}

				ndu[ j ][ j ] = saved;

			}

			for ( let j = 0; j <= p; ++ j ) {

				ders[ 0 ][ j ] = ndu[ j ][ p ];

			}

			for ( let r = 0; r <= p; ++ r ) {

				let s1 = 0;
				let s2 = 1;
				const a = [];

				for ( let i = 0; i <= p; ++ i ) {

					a[ i ] = zeroArr.slice( 0 );

				}

				a[ 0 ][ 0 ] = 1.0;

				for ( let k = 1; k <= n; ++ k ) {

					let d = 0.0;
					const rk = r - k;
					const pk = p - k;

					if ( r >= k ) {

						a[ s2 ][ 0 ] = a[ s1 ][ 0 ] / ndu[ pk + 1 ][ rk ];
						d = a[ s2 ][ 0 ] * ndu[ rk ][ pk ];

					}

					const j1 = rk >= - 1 ? 1 : - rk;
					const j2 = r - 1 <= pk ? k - 1 : p - r;

					for ( let j = j1; j <= j2; ++ j ) {

						a[ s2 ][ j ] = ( a[ s1 ][ j ] - a[ s1 ][ j - 1 ] ) / ndu[ pk + 1 ][ rk + j ];
						d += a[ s2 ][ j ] * ndu[ rk + j ][ pk ];

					}

					if ( r <= pk ) {

						a[ s2 ][ k ] = - a[ s1 ][ k - 1 ] / ndu[ pk + 1 ][ r ];
						d += a[ s2 ][ k ] * ndu[ r ][ pk ];

					}

					ders[ k ][ r ] = d;
					const j = s1;
					s1 = s2;
					s2 = j;

				}

			}

			let r = p;

			for ( let k = 1; k <= n; ++ k ) {

				for ( let j = 0; j <= p; ++ j ) {

					ders[ k ][ j ] *= r;

				}

				r *= p - k;

			}

			return ders;

		}
		/*
  	Calculate derivatives of a B-Spline. See The NURBS Book, page 93, algorithm A3.2.
  		p  : degree
  	U  : knot vector
  	P  : control points
  	u  : Parametric points
  	nd : number of derivatives
  		returns array[d+1] with derivatives
  	*/


		static calcBSplineDerivatives( p, U, P, u, nd ) {

			const du = nd < p ? nd : p;
			const CK = [];
			const span = this.findSpan( p, u, U );
			const nders = this.calcBasisFunctionDerivatives( span, u, p, du, U );
			const Pw = [];

			for ( let i = 0; i < P.length; ++ i ) {

				const point = P[ i ].clone();
				const w = point.w;
				point.x *= w;
				point.y *= w;
				point.z *= w;
				Pw[ i ] = point;

			}

			for ( let k = 0; k <= du; ++ k ) {

				const point = Pw[ span - p ].clone().multiplyScalar( nders[ k ][ 0 ] );

				for ( let j = 1; j <= p; ++ j ) {

					point.add( Pw[ span - p + j ].clone().multiplyScalar( nders[ k ][ j ] ) );

				}

				CK[ k ] = point;

			}

			for ( let k = du + 1; k <= nd + 1; ++ k ) {

				CK[ k ] = new THREE.Vector4( 0, 0, 0 );

			}

			return CK;

		}
		/*
  Calculate "K over I"
  	returns k!/(i!(k-i)!)
  */


		static calcKoverI( k, i ) {

			let nom = 1;

			for ( let j = 2; j <= k; ++ j ) {

				nom *= j;

			}

			let denom = 1;

			for ( let j = 2; j <= i; ++ j ) {

				denom *= j;

			}

			for ( let j = 2; j <= k - i; ++ j ) {

				denom *= j;

			}

			return nom / denom;

		}
		/*
  Calculate derivatives (0-nd) of rational curve. See The NURBS Book, page 127, algorithm A4.2.
  	Pders : result of function calcBSplineDerivatives
  	returns array with derivatives for rational curve.
  */


		static calcRationalCurveDerivatives( Pders ) {

			const nd = Pders.length;
			const Aders = [];
			const wders = [];

			for ( let i = 0; i < nd; ++ i ) {

				const point = Pders[ i ];
				Aders[ i ] = new THREE.Vector3( point.x, point.y, point.z );
				wders[ i ] = point.w;

			}

			const CK = [];

			for ( let k = 0; k < nd; ++ k ) {

				const v = Aders[ k ].clone();

				for ( let i = 1; i <= k; ++ i ) {

					v.sub( CK[ k - i ].clone().multiplyScalar( this.calcKoverI( k, i ) * wders[ i ] ) );

				}

				CK[ k ] = v.divideScalar( wders[ 0 ] );

			}

			return CK;

		}
		/*
  Calculate NURBS curve derivatives. See The NURBS Book, page 127, algorithm A4.2.
  	p  : degree
  U  : knot vector
  P  : control points in homogeneous space
  u  : parametric points
  nd : number of derivatives
  	returns array with derivatives.
  */


		static calcNURBSDerivatives( p, U, P, u, nd ) {

			const Pders = this.calcBSplineDerivatives( p, U, P, u, nd );
			return this.calcRationalCurveDerivatives( Pders );

		}
		/*
  Calculate rational B-Spline surface point. See The NURBS Book, page 134, algorithm A4.3.
  	p1, p2 : degrees of B-Spline surface
  U1, U2 : knot vectors
  P      : control points (x, y, z, w)
  u, v   : parametric values
  	returns point for given (u, v)
  */


		static calcSurfacePoint( p, q, U, V, P, u, v, target ) {

			const uspan = this.findSpan( p, u, U );
			const vspan = this.findSpan( q, v, V );
			const Nu = this.calcBasisFunctions( uspan, u, p, U );
			const Nv = this.calcBasisFunctions( vspan, v, q, V );
			const temp = [];

			for ( let l = 0; l <= q; ++ l ) {

				temp[ l ] = new THREE.Vector4( 0, 0, 0, 0 );

				for ( let k = 0; k <= p; ++ k ) {

					const point = P[ uspan - p + k ][ vspan - q + l ].clone();
					const w = point.w;
					point.x *= w;
					point.y *= w;
					point.z *= w;
					temp[ l ].add( point.multiplyScalar( Nu[ k ] ) );

				}

			}

			const Sw = new THREE.Vector4( 0, 0, 0, 0 );

			for ( let l = 0; l <= q; ++ l ) {

				Sw.add( temp[ l ].multiplyScalar( Nv[ l ] ) );

			}

			Sw.divideScalar( Sw.w );
			target.set( Sw.x, Sw.y, Sw.z );

		}

	}

	THREE.NURBSUtils = NURBSUtils;

} )();

( function () {

	/**
 * NURBS curve object
 *
 * Derives from THREE.Curve, overriding getPoint and getTangent.
 *
 * Implementation is based on (x, y [, z=0 [, w=1]]) control points with w=weight.
 *
 **/

	class NURBSCurve extends THREE.Curve {

		constructor( degree, knots
			/* array of reals */
			, controlPoints
			/* array of Vector(2|3|4) */
			, startKnot
			/* index in knots */
			, endKnot
			/* index in knots */
		) {

			super();
			this.degree = degree;
			this.knots = knots;
			this.controlPoints = []; // Used by periodic NURBS to remove hidden spans

			this.startKnot = startKnot || 0;
			this.endKnot = endKnot || this.knots.length - 1;

			for ( let i = 0; i < controlPoints.length; ++ i ) {

				// ensure THREE.Vector4 for control points
				const point = controlPoints[ i ];
				this.controlPoints[ i ] = new THREE.Vector4( point.x, point.y, point.z, point.w );

			}

		}

		getPoint( t, optionalTarget = new THREE.Vector3() ) {

			const point = optionalTarget;
			const u = this.knots[ this.startKnot ] + t * ( this.knots[ this.endKnot ] - this.knots[ this.startKnot ] ); // linear mapping t->u
			// following results in (wx, wy, wz, w) homogeneous point

			const hpoint = THREE.NURBSUtils.calcBSplinePoint( this.degree, this.knots, this.controlPoints, u );

			if ( hpoint.w !== 1.0 ) {

				// project to 3D space: (wx, wy, wz, w) -> (x, y, z, 1)
				hpoint.divideScalar( hpoint.w );

			}

			return point.set( hpoint.x, hpoint.y, hpoint.z );

		}

		getTangent( t, optionalTarget = new THREE.Vector3() ) {

			const tangent = optionalTarget;
			const u = this.knots[ 0 ] + t * ( this.knots[ this.knots.length - 1 ] - this.knots[ 0 ] );
			const ders = THREE.NURBSUtils.calcNURBSDerivatives( this.degree, this.knots, this.controlPoints, u, 1 );
			tangent.copy( ders[ 1 ] ).normalize();
			return tangent;

		}

	}

	THREE.NURBSCurve = NURBSCurve;

} )();

( function () {

	class TGALoader extends THREE.DataTextureLoader {

		constructor( manager ) {

			super( manager );

		}

		parse( buffer ) {

			// reference from vthibault, https://github.com/vthibault/roBrowser/blob/master/src/Loaders/Targa.js
			function tgaCheckHeader( header ) {

				switch ( header.image_type ) {

					// check indexed type
					case TGA_TYPE_INDEXED:
					case TGA_TYPE_RLE_INDEXED:
						if ( header.colormap_length > 256 || header.colormap_size !== 24 || header.colormap_type !== 1 ) {

							console.error( 'THREE.TGALoader: Invalid type colormap data for indexed type.' );

						}

						break;
						// check colormap type

					case TGA_TYPE_RGB:
					case TGA_TYPE_GREY:
					case TGA_TYPE_RLE_RGB:
					case TGA_TYPE_RLE_GREY:
						if ( header.colormap_type ) {

							console.error( 'THREE.TGALoader: Invalid type colormap data for colormap type.' );

						}

						break;
						// What the need of a file without data ?

					case TGA_TYPE_NO_DATA:
						console.error( 'THREE.TGALoader: No data.' );
						// Invalid type ?

					default:
						console.error( 'THREE.TGALoader: Invalid type "%s".', header.image_type );

				} // check image width and height


				if ( header.width <= 0 || header.height <= 0 ) {

					console.error( 'THREE.TGALoader: Invalid image size.' );

				} // check image pixel size


				if ( header.pixel_size !== 8 && header.pixel_size !== 16 && header.pixel_size !== 24 && header.pixel_size !== 32 ) {

					console.error( 'THREE.TGALoader: Invalid pixel size "%s".', header.pixel_size );

				}

			} // parse tga image buffer


			function tgaParse( use_rle, use_pal, header, offset, data ) {

				let pixel_data, palettes;
				const pixel_size = header.pixel_size >> 3;
				const pixel_total = header.width * header.height * pixel_size; // read palettes

				if ( use_pal ) {

					palettes = data.subarray( offset, offset += header.colormap_length * ( header.colormap_size >> 3 ) );

				} // read RLE


				if ( use_rle ) {

					pixel_data = new Uint8Array( pixel_total );
					let c, count, i;
					let shift = 0;
					const pixels = new Uint8Array( pixel_size );

					while ( shift < pixel_total ) {

						c = data[ offset ++ ];
						count = ( c & 0x7f ) + 1; // RLE pixels

						if ( c & 0x80 ) {

							// bind pixel tmp array
							for ( i = 0; i < pixel_size; ++ i ) {

								pixels[ i ] = data[ offset ++ ];

							} // copy pixel array


							for ( i = 0; i < count; ++ i ) {

								pixel_data.set( pixels, shift + i * pixel_size );

							}

							shift += pixel_size * count;

						} else {

							// raw pixels
							count *= pixel_size;

							for ( i = 0; i < count; ++ i ) {

								pixel_data[ shift + i ] = data[ offset ++ ];

							}

							shift += count;

						}

					}

				} else {

					// raw pixels
					pixel_data = data.subarray( offset, offset += use_pal ? header.width * header.height : pixel_total );

				}

				return {
					pixel_data: pixel_data,
					palettes: palettes
				};

			}

			function tgaGetImageData8bits( imageData, y_start, y_step, y_end, x_start, x_step, x_end, image, palettes ) {

				const colormap = palettes;
				let color,
					i = 0,
					x,
					y;
				const width = header.width;

				for ( y = y_start; y !== y_end; y += y_step ) {

					for ( x = x_start; x !== x_end; x += x_step, i ++ ) {

						color = image[ i ];
						imageData[ ( x + width * y ) * 4 + 3 ] = 255;
						imageData[ ( x + width * y ) * 4 + 2 ] = colormap[ color * 3 + 0 ];
						imageData[ ( x + width * y ) * 4 + 1 ] = colormap[ color * 3 + 1 ];
						imageData[ ( x + width * y ) * 4 + 0 ] = colormap[ color * 3 + 2 ];

					}

				}

				return imageData;

			}

			function tgaGetImageData16bits( imageData, y_start, y_step, y_end, x_start, x_step, x_end, image ) {

				let color,
					i = 0,
					x,
					y;
				const width = header.width;

				for ( y = y_start; y !== y_end; y += y_step ) {

					for ( x = x_start; x !== x_end; x += x_step, i += 2 ) {

						color = image[ i + 0 ] + ( image[ i + 1 ] << 8 ); // Inversed ?

						imageData[ ( x + width * y ) * 4 + 0 ] = ( color & 0x7C00 ) >> 7;
						imageData[ ( x + width * y ) * 4 + 1 ] = ( color & 0x03E0 ) >> 2;
						imageData[ ( x + width * y ) * 4 + 2 ] = ( color & 0x001F ) >> 3;
						imageData[ ( x + width * y ) * 4 + 3 ] = color & 0x8000 ? 0 : 255;

					}

				}

				return imageData;

			}

			function tgaGetImageData24bits( imageData, y_start, y_step, y_end, x_start, x_step, x_end, image ) {

				let i = 0,
					x,
					y;
				const width = header.width;

				for ( y = y_start; y !== y_end; y += y_step ) {

					for ( x = x_start; x !== x_end; x += x_step, i += 3 ) {

						imageData[ ( x + width * y ) * 4 + 3 ] = 255;
						imageData[ ( x + width * y ) * 4 + 2 ] = image[ i + 0 ];
						imageData[ ( x + width * y ) * 4 + 1 ] = image[ i + 1 ];
						imageData[ ( x + width * y ) * 4 + 0 ] = image[ i + 2 ];

					}

				}

				return imageData;

			}

			function tgaGetImageData32bits( imageData, y_start, y_step, y_end, x_start, x_step, x_end, image ) {

				let i = 0,
					x,
					y;
				const width = header.width;

				for ( y = y_start; y !== y_end; y += y_step ) {

					for ( x = x_start; x !== x_end; x += x_step, i += 4 ) {

						imageData[ ( x + width * y ) * 4 + 2 ] = image[ i + 0 ];
						imageData[ ( x + width * y ) * 4 + 1 ] = image[ i + 1 ];
						imageData[ ( x + width * y ) * 4 + 0 ] = image[ i + 2 ];
						imageData[ ( x + width * y ) * 4 + 3 ] = image[ i + 3 ];

					}

				}

				return imageData;

			}

			function tgaGetImageDataGrey8bits( imageData, y_start, y_step, y_end, x_start, x_step, x_end, image ) {

				let color,
					i = 0,
					x,
					y;
				const width = header.width;

				for ( y = y_start; y !== y_end; y += y_step ) {

					for ( x = x_start; x !== x_end; x += x_step, i ++ ) {

						color = image[ i ];
						imageData[ ( x + width * y ) * 4 + 0 ] = color;
						imageData[ ( x + width * y ) * 4 + 1 ] = color;
						imageData[ ( x + width * y ) * 4 + 2 ] = color;
						imageData[ ( x + width * y ) * 4 + 3 ] = 255;

					}

				}

				return imageData;

			}

			function tgaGetImageDataGrey16bits( imageData, y_start, y_step, y_end, x_start, x_step, x_end, image ) {

				let i = 0,
					x,
					y;
				const width = header.width;

				for ( y = y_start; y !== y_end; y += y_step ) {

					for ( x = x_start; x !== x_end; x += x_step, i += 2 ) {

						imageData[ ( x + width * y ) * 4 + 0 ] = image[ i + 0 ];
						imageData[ ( x + width * y ) * 4 + 1 ] = image[ i + 0 ];
						imageData[ ( x + width * y ) * 4 + 2 ] = image[ i + 0 ];
						imageData[ ( x + width * y ) * 4 + 3 ] = image[ i + 1 ];

					}

				}

				return imageData;

			}

			function getTgaRGBA( data, width, height, image, palette ) {

				let x_start, y_start, x_step, y_step, x_end, y_end;

				switch ( ( header.flags & TGA_ORIGIN_MASK ) >> TGA_ORIGIN_SHIFT ) {

					default:
					case TGA_ORIGIN_UL:
						x_start = 0;
						x_step = 1;
						x_end = width;
						y_start = 0;
						y_step = 1;
						y_end = height;
						break;

					case TGA_ORIGIN_BL:
						x_start = 0;
						x_step = 1;
						x_end = width;
						y_start = height - 1;
						y_step = - 1;
						y_end = - 1;
						break;

					case TGA_ORIGIN_UR:
						x_start = width - 1;
						x_step = - 1;
						x_end = - 1;
						y_start = 0;
						y_step = 1;
						y_end = height;
						break;

					case TGA_ORIGIN_BR:
						x_start = width - 1;
						x_step = - 1;
						x_end = - 1;
						y_start = height - 1;
						y_step = - 1;
						y_end = - 1;
						break;

				}

				if ( use_grey ) {

					switch ( header.pixel_size ) {

						case 8:
							tgaGetImageDataGrey8bits( data, y_start, y_step, y_end, x_start, x_step, x_end, image );
							break;

						case 16:
							tgaGetImageDataGrey16bits( data, y_start, y_step, y_end, x_start, x_step, x_end, image );
							break;

						default:
							console.error( 'THREE.TGALoader: Format not supported.' );
							break;

					}

				} else {

					switch ( header.pixel_size ) {

						case 8:
							tgaGetImageData8bits( data, y_start, y_step, y_end, x_start, x_step, x_end, image, palette );
							break;

						case 16:
							tgaGetImageData16bits( data, y_start, y_step, y_end, x_start, x_step, x_end, image );
							break;

						case 24:
							tgaGetImageData24bits( data, y_start, y_step, y_end, x_start, x_step, x_end, image );
							break;

						case 32:
							tgaGetImageData32bits( data, y_start, y_step, y_end, x_start, x_step, x_end, image );
							break;

						default:
							console.error( 'THREE.TGALoader: Format not supported.' );
							break;

					}

				} // Load image data according to specific method
				// let func = 'tgaGetImageData' + (use_grey ? 'Grey' : '') + (header.pixel_size) + 'bits';
				// func(data, y_start, y_step, y_end, x_start, x_step, x_end, width, image, palette );


				return data;

			} // TGA constants


			const TGA_TYPE_NO_DATA = 0,
				TGA_TYPE_INDEXED = 1,
				TGA_TYPE_RGB = 2,
				TGA_TYPE_GREY = 3,
				TGA_TYPE_RLE_INDEXED = 9,
				TGA_TYPE_RLE_RGB = 10,
				TGA_TYPE_RLE_GREY = 11,
				TGA_ORIGIN_MASK = 0x30,
				TGA_ORIGIN_SHIFT = 0x04,
				TGA_ORIGIN_BL = 0x00,
				TGA_ORIGIN_BR = 0x01,
				TGA_ORIGIN_UL = 0x02,
				TGA_ORIGIN_UR = 0x03;
			if ( buffer.length < 19 ) console.error( 'THREE.TGALoader: Not enough data to contain header.' );
			let offset = 0;
			const content = new Uint8Array( buffer ),
				header = {
					id_length: content[ offset ++ ],
					colormap_type: content[ offset ++ ],
					image_type: content[ offset ++ ],
					colormap_index: content[ offset ++ ] | content[ offset ++ ] << 8,
					colormap_length: content[ offset ++ ] | content[ offset ++ ] << 8,
					colormap_size: content[ offset ++ ],
					origin: [ content[ offset ++ ] | content[ offset ++ ] << 8, content[ offset ++ ] | content[ offset ++ ] << 8 ],
					width: content[ offset ++ ] | content[ offset ++ ] << 8,
					height: content[ offset ++ ] | content[ offset ++ ] << 8,
					pixel_size: content[ offset ++ ],
					flags: content[ offset ++ ]
				}; // check tga if it is valid format

			tgaCheckHeader( header );

			if ( header.id_length + offset > buffer.length ) {

				console.error( 'THREE.TGALoader: No data.' );

			} // skip the needn't data


			offset += header.id_length; // get targa information about RLE compression and palette

			let use_rle = false,
				use_pal = false,
				use_grey = false;

			switch ( header.image_type ) {

				case TGA_TYPE_RLE_INDEXED:
					use_rle = true;
					use_pal = true;
					break;

				case TGA_TYPE_INDEXED:
					use_pal = true;
					break;

				case TGA_TYPE_RLE_RGB:
					use_rle = true;
					break;

				case TGA_TYPE_RGB:
					break;

				case TGA_TYPE_RLE_GREY:
					use_rle = true;
					use_grey = true;
					break;

				case TGA_TYPE_GREY:
					use_grey = true;
					break;

			} //


			const imageData = new Uint8Array( header.width * header.height * 4 );
			const result = tgaParse( use_rle, use_pal, header, offset, content );
			getTgaRGBA( imageData, header.width, header.height, result.pixel_data, result.palettes );
			return {
				data: imageData,
				width: header.width,
				height: header.height,
				flipY: true,
				generateMipmaps: true,
				minFilter: THREE.LinearMipmapLinearFilter
			};

		}

	}

	THREE.TGALoader = TGALoader;

} )();

( function () {

	/**
 * THREE.Loader loads FBX file and generates THREE.Group representing FBX scene.
 * Requires FBX file to be >= 7.0 and in ASCII or >= 6400 in Binary format
 * Versions lower than this may load but will probably have errors
 *
 * Needs Support:
 *  Morph normals / blend shape normals
 *
 * FBX format references:
 * 	https://wiki.blender.org/index.php/User:Mont29/Foundation/FBX_File_Structure
 * 	http://help.autodesk.com/view/FBX/2017/ENU/?guid=__cpp_ref_index_html (C++ SDK reference)
 *
 * 	Binary format specification:
 *		https://code.blender.org/2013/08/fbx-binary-file-format-specification/
 */

	let fbxTree;
	let connections;
	let sceneGraph;

	class FBXLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const path = scope.path === '' ? THREE.LoaderUtils.extractUrlBase( url ) : scope.path;
			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( scope.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( scope.requestHeader );
			loader.setWithCredentials( scope.withCredentials );
			loader.load( url, function ( buffer ) {

				try {

					onLoad( scope.parse( buffer, path ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		parse( FBXBuffer, path ) {

			if ( isFbxFormatBinary( FBXBuffer ) ) {

				fbxTree = new BinaryParser().parse( FBXBuffer );

			} else {

				const FBXText = convertArrayBufferToString( FBXBuffer );

				if ( ! isFbxFormatASCII( FBXText ) ) {

					throw new Error( 'THREE.FBXLoader: Unknown format.' );

				}

				if ( getFbxVersion( FBXText ) < 7000 ) {

					throw new Error( 'THREE.FBXLoader: FBX version not supported, FileVersion: ' + getFbxVersion( FBXText ) );

				}

				fbxTree = new TextParser().parse( FBXText );

			} // console.log( fbxTree );


			const textureLoader = new THREE.TextureLoader( this.manager ).setPath( this.resourcePath || path ).setCrossOrigin( this.crossOrigin );
			return new FBXTreeParser( textureLoader, this.manager ).parse( fbxTree );

		}

	} // Parse the FBXTree object returned by the BinaryParser or TextParser and return a THREE.Group


	class FBXTreeParser {

		constructor( textureLoader, manager ) {

			this.textureLoader = textureLoader;
			this.manager = manager;

		}

		parse() {

			connections = this.parseConnections();
			const images = this.parseImages();
			const textures = this.parseTextures( images );
			const materials = this.parseMaterials( textures );
			const deformers = this.parseDeformers();
			const geometryMap = new GeometryParser().parse( deformers );
			this.parseScene( deformers, geometryMap, materials );
			return sceneGraph;

		} // Parses FBXTree.Connections which holds parent-child connections between objects (e.g. material -> texture, model->geometry )
		// and details the connection type


		parseConnections() {

			const connectionMap = new Map();

			if ( 'Connections' in fbxTree ) {

				const rawConnections = fbxTree.Connections.connections;
				rawConnections.forEach( function ( rawConnection ) {

					const fromID = rawConnection[ 0 ];
					const toID = rawConnection[ 1 ];
					const relationship = rawConnection[ 2 ];

					if ( ! connectionMap.has( fromID ) ) {

						connectionMap.set( fromID, {
							parents: [],
							children: []
						} );

					}

					const parentRelationship = {
						ID: toID,
						relationship: relationship
					};
					connectionMap.get( fromID ).parents.push( parentRelationship );

					if ( ! connectionMap.has( toID ) ) {

						connectionMap.set( toID, {
							parents: [],
							children: []
						} );

					}

					const childRelationship = {
						ID: fromID,
						relationship: relationship
					};
					connectionMap.get( toID ).children.push( childRelationship );

				} );

			}

			return connectionMap;

		} // Parse FBXTree.Objects.Video for embedded image data
		// These images are connected to textures in FBXTree.Objects.Textures
		// via FBXTree.Connections.


		parseImages() {

			const images = {};
			const blobs = {};

			if ( 'Video' in fbxTree.Objects ) {

				const videoNodes = fbxTree.Objects.Video;

				for ( const nodeID in videoNodes ) {

					const videoNode = videoNodes[ nodeID ];
					const id = parseInt( nodeID );
					images[ id ] = videoNode.RelativeFilename || videoNode.Filename; // raw image data is in videoNode.Content

					if ( 'Content' in videoNode ) {

						const arrayBufferContent = videoNode.Content instanceof ArrayBuffer && videoNode.Content.byteLength > 0;
						const base64Content = typeof videoNode.Content === 'string' && videoNode.Content !== '';

						if ( arrayBufferContent || base64Content ) {

							const image = this.parseImage( videoNodes[ nodeID ] );
							blobs[ videoNode.RelativeFilename || videoNode.Filename ] = image;

						}

					}

				}

			}

			for ( const id in images ) {

				const filename = images[ id ];
				if ( blobs[ filename ] !== undefined ) images[ id ] = blobs[ filename ]; else images[ id ] = images[ id ].split( '\\' ).pop();

			}

			return images;

		} // Parse embedded image data in FBXTree.Video.Content


		parseImage( videoNode ) {

			const content = videoNode.Content;
			const fileName = videoNode.RelativeFilename || videoNode.Filename;
			const extension = fileName.slice( fileName.lastIndexOf( '.' ) + 1 ).toLowerCase();
			let type;

			switch ( extension ) {

				case 'bmp':
					type = 'image/bmp';
					break;

				case 'jpg':
				case 'jpeg':
					type = 'image/jpeg';
					break;

				case 'png':
					type = 'image/png';
					break;

				case 'tif':
					type = 'image/tiff';
					break;

				case 'tga':
					if ( this.manager.getHandler( '.tga' ) === null ) {

						console.warn( 'FBXLoader: TGA loader not found, skipping ', fileName );

					}

					type = 'image/tga';
					break;

				default:
					console.warn( 'FBXLoader: Image type "' + extension + '" is not supported.' );
					return;

			}

			if ( typeof content === 'string' ) {

				// ASCII format
				return 'data:' + type + ';base64,' + content;

			} else {

				// Binary Format
				const array = new Uint8Array( content );
				return window.URL.createObjectURL( new Blob( [ array ], {
					type: type
				} ) );

			}

		} // Parse nodes in FBXTree.Objects.Texture
		// These contain details such as UV scaling, cropping, rotation etc and are connected
		// to images in FBXTree.Objects.Video


		parseTextures( images ) {

			const textureMap = new Map();

			if ( 'Texture' in fbxTree.Objects ) {

				const textureNodes = fbxTree.Objects.Texture;

				for ( const nodeID in textureNodes ) {

					const texture = this.parseTexture( textureNodes[ nodeID ], images );
					textureMap.set( parseInt( nodeID ), texture );

				}

			}

			return textureMap;

		} // Parse individual node in FBXTree.Objects.Texture


		parseTexture( textureNode, images ) {

			const texture = this.loadTexture( textureNode, images );
			texture.ID = textureNode.id;
			texture.name = textureNode.attrName;
			const wrapModeU = textureNode.WrapModeU;
			const wrapModeV = textureNode.WrapModeV;
			const valueU = wrapModeU !== undefined ? wrapModeU.value : 0;
			const valueV = wrapModeV !== undefined ? wrapModeV.value : 0; // http://download.autodesk.com/us/fbx/SDKdocs/FBX_SDK_Help/files/fbxsdkref/class_k_fbx_texture.html#889640e63e2e681259ea81061b85143a
			// 0: repeat(default), 1: clamp

			texture.wrapS = valueU === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
			texture.wrapT = valueV === 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;

			if ( 'Scaling' in textureNode ) {

				const values = textureNode.Scaling.value;
				texture.repeat.x = values[ 0 ];
				texture.repeat.y = values[ 1 ];

			}

			return texture;

		} // load a texture specified as a blob or data URI, or via an external URL using THREE.TextureLoader


		loadTexture( textureNode, images ) {

			let fileName;
			const currentPath = this.textureLoader.path;
			const children = connections.get( textureNode.id ).children;

			if ( children !== undefined && children.length > 0 && images[ children[ 0 ].ID ] !== undefined ) {

				fileName = images[ children[ 0 ].ID ];

				if ( fileName.indexOf( 'blob:' ) === 0 || fileName.indexOf( 'data:' ) === 0 ) {

					this.textureLoader.setPath( undefined );

				}

			}

			let texture;
			const extension = textureNode.FileName.slice( - 3 ).toLowerCase();

			if ( extension === 'tga' ) {

				const loader = this.manager.getHandler( '.tga' );

				if ( loader === null ) {

					console.warn( 'FBXLoader: TGA loader not found, creating placeholder texture for', textureNode.RelativeFilename );
					texture = new THREE.Texture();

				} else {

					loader.setPath( this.textureLoader.path );
					texture = loader.load( fileName );

				}

			} else if ( extension === 'psd' ) {

				console.warn( 'FBXLoader: PSD textures are not supported, creating placeholder texture for', textureNode.RelativeFilename );
				texture = new THREE.Texture();

			} else {

				texture = this.textureLoader.load( fileName );

			}

			this.textureLoader.setPath( currentPath );
			return texture;

		} // Parse nodes in FBXTree.Objects.Material


		parseMaterials( textureMap ) {

			const materialMap = new Map();

			if ( 'Material' in fbxTree.Objects ) {

				const materialNodes = fbxTree.Objects.Material;

				for ( const nodeID in materialNodes ) {

					const material = this.parseMaterial( materialNodes[ nodeID ], textureMap );
					if ( material !== null ) materialMap.set( parseInt( nodeID ), material );

				}

			}

			return materialMap;

		} // Parse single node in FBXTree.Objects.Material
		// Materials are connected to texture maps in FBXTree.Objects.Textures
		// FBX format currently only supports Lambert and Phong shading models


		parseMaterial( materialNode, textureMap ) {

			const ID = materialNode.id;
			const name = materialNode.attrName;
			let type = materialNode.ShadingModel; // Case where FBX wraps shading model in property object.

			if ( typeof type === 'object' ) {

				type = type.value;

			} // Ignore unused materials which don't have any connections.


			if ( ! connections.has( ID ) ) return null;
			const parameters = this.parseParameters( materialNode, textureMap, ID );
			let material;

			switch ( type.toLowerCase() ) {

				case 'phong':
					material = new THREE.MeshPhongMaterial();
					break;

				case 'lambert':
					material = new THREE.MeshLambertMaterial();
					break;

				default:
					console.warn( 'THREE.FBXLoader: unknown material type "%s". Defaulting to THREE.MeshPhongMaterial.', type );
					material = new THREE.MeshPhongMaterial();
					break;

			}

			material.setValues( parameters );
			material.name = name;
			return material;

		} // Parse FBX material and return parameters suitable for a three.js material
		// Also parse the texture map and return any textures associated with the material


		parseParameters( materialNode, textureMap, ID ) {

			const parameters = {};

			if ( materialNode.BumpFactor ) {

				parameters.bumpScale = materialNode.BumpFactor.value;

			}

			if ( materialNode.Diffuse ) {

				parameters.color = new THREE.Color().fromArray( materialNode.Diffuse.value );

			} else if ( materialNode.DiffuseColor && ( materialNode.DiffuseColor.type === 'Color' || materialNode.DiffuseColor.type === 'ColorRGB' ) ) {

				// The blender exporter exports diffuse here instead of in materialNode.Diffuse
				parameters.color = new THREE.Color().fromArray( materialNode.DiffuseColor.value );

			}

			if ( materialNode.DisplacementFactor ) {

				parameters.displacementScale = materialNode.DisplacementFactor.value;

			}

			if ( materialNode.Emissive ) {

				parameters.emissive = new THREE.Color().fromArray( materialNode.Emissive.value );

			} else if ( materialNode.EmissiveColor && ( materialNode.EmissiveColor.type === 'Color' || materialNode.EmissiveColor.type === 'ColorRGB' ) ) {

				// The blender exporter exports emissive color here instead of in materialNode.Emissive
				parameters.emissive = new THREE.Color().fromArray( materialNode.EmissiveColor.value );

			}

			if ( materialNode.EmissiveFactor ) {

				parameters.emissiveIntensity = parseFloat( materialNode.EmissiveFactor.value );

			}

			if ( materialNode.Opacity ) {

				parameters.opacity = parseFloat( materialNode.Opacity.value );

			}

			if ( parameters.opacity < 1.0 ) {

				parameters.transparent = true;

			}

			if ( materialNode.ReflectionFactor ) {

				parameters.reflectivity = materialNode.ReflectionFactor.value;

			}

			if ( materialNode.Shininess ) {

				parameters.shininess = materialNode.Shininess.value;

			}

			if ( materialNode.Specular ) {

				parameters.specular = new THREE.Color().fromArray( materialNode.Specular.value );

			} else if ( materialNode.SpecularColor && materialNode.SpecularColor.type === 'Color' ) {

				// The blender exporter exports specular color here instead of in materialNode.Specular
				parameters.specular = new THREE.Color().fromArray( materialNode.SpecularColor.value );

			}

			const scope = this;
			connections.get( ID ).children.forEach( function ( child ) {

				const type = child.relationship;

				switch ( type ) {

					case 'Bump':
						parameters.bumpMap = scope.getTexture( textureMap, child.ID );
						break;

					case 'Maya|TEX_ao_map':
						parameters.aoMap = scope.getTexture( textureMap, child.ID );
						break;

					case 'DiffuseColor':
					case 'Maya|TEX_color_map':
						parameters.map = scope.getTexture( textureMap, child.ID );
						parameters.map.encoding = THREE.sRGBEncoding;
						break;

					case 'DisplacementColor':
						parameters.displacementMap = scope.getTexture( textureMap, child.ID );
						break;

					case 'EmissiveColor':
						parameters.emissiveMap = scope.getTexture( textureMap, child.ID );
						parameters.emissiveMap.encoding = THREE.sRGBEncoding;
						break;

					case 'NormalMap':
					case 'Maya|TEX_normal_map':
						parameters.normalMap = scope.getTexture( textureMap, child.ID );
						break;

					case 'ReflectionColor':
						parameters.envMap = scope.getTexture( textureMap, child.ID );
						parameters.envMap.mapping = THREE.EquirectangularReflectionMapping;
						parameters.envMap.encoding = THREE.sRGBEncoding;
						break;

					case 'SpecularColor':
						parameters.specularMap = scope.getTexture( textureMap, child.ID );
						parameters.specularMap.encoding = THREE.sRGBEncoding;
						break;

					case 'TransparentColor':
					case 'TransparencyFactor':
						parameters.alphaMap = scope.getTexture( textureMap, child.ID );
						parameters.transparent = true;
						break;

					case 'AmbientColor':
					case 'ShininessExponent': // AKA glossiness map

					case 'SpecularFactor': // AKA specularLevel

					case 'VectorDisplacementColor': // NOTE: Seems to be a copy of DisplacementColor

					default:
						console.warn( 'THREE.FBXLoader: %s map is not supported in three.js, skipping texture.', type );
						break;

				}

			} );
			return parameters;

		} // get a texture from the textureMap for use by a material.


		getTexture( textureMap, id ) {

			// if the texture is a layered texture, just use the first layer and issue a warning
			if ( 'LayeredTexture' in fbxTree.Objects && id in fbxTree.Objects.LayeredTexture ) {

				console.warn( 'THREE.FBXLoader: layered textures are not supported in three.js. Discarding all but first layer.' );
				id = connections.get( id ).children[ 0 ].ID;

			}

			return textureMap.get( id );

		} // Parse nodes in FBXTree.Objects.Deformer
		// Deformer node can contain skinning or Vertex Cache animation data, however only skinning is supported here
		// Generates map of THREE.Skeleton-like objects for use later when generating and binding skeletons.


		parseDeformers() {

			const skeletons = {};
			const morphTargets = {};

			if ( 'Deformer' in fbxTree.Objects ) {

				const DeformerNodes = fbxTree.Objects.Deformer;

				for ( const nodeID in DeformerNodes ) {

					const deformerNode = DeformerNodes[ nodeID ];
					const relationships = connections.get( parseInt( nodeID ) );

					if ( deformerNode.attrType === 'Skin' ) {

						const skeleton = this.parseSkeleton( relationships, DeformerNodes );
						skeleton.ID = nodeID;
						if ( relationships.parents.length > 1 ) console.warn( 'THREE.FBXLoader: skeleton attached to more than one geometry is not supported.' );
						skeleton.geometryID = relationships.parents[ 0 ].ID;
						skeletons[ nodeID ] = skeleton;

					} else if ( deformerNode.attrType === 'BlendShape' ) {

						const morphTarget = {
							id: nodeID
						};
						morphTarget.rawTargets = this.parseMorphTargets( relationships, DeformerNodes );
						morphTarget.id = nodeID;
						if ( relationships.parents.length > 1 ) console.warn( 'THREE.FBXLoader: morph target attached to more than one geometry is not supported.' );
						morphTargets[ nodeID ] = morphTarget;

					}

				}

			}

			return {
				skeletons: skeletons,
				morphTargets: morphTargets
			};

		} // Parse single nodes in FBXTree.Objects.Deformer
		// The top level skeleton node has type 'Skin' and sub nodes have type 'Cluster'
		// Each skin node represents a skeleton and each cluster node represents a bone


		parseSkeleton( relationships, deformerNodes ) {

			const rawBones = [];
			relationships.children.forEach( function ( child ) {

				const boneNode = deformerNodes[ child.ID ];
				if ( boneNode.attrType !== 'Cluster' ) return;
				const rawBone = {
					ID: child.ID,
					indices: [],
					weights: [],
					transformLink: new THREE.Matrix4().fromArray( boneNode.TransformLink.a ) // transform: new THREE.Matrix4().fromArray( boneNode.Transform.a ),
					// linkMode: boneNode.Mode,

				};

				if ( 'Indexes' in boneNode ) {

					rawBone.indices = boneNode.Indexes.a;
					rawBone.weights = boneNode.Weights.a;

				}

				rawBones.push( rawBone );

			} );
			return {
				rawBones: rawBones,
				bones: []
			};

		} // The top level morph deformer node has type "BlendShape" and sub nodes have type "BlendShapeChannel"


		parseMorphTargets( relationships, deformerNodes ) {

			const rawMorphTargets = [];

			for ( let i = 0; i < relationships.children.length; i ++ ) {

				const child = relationships.children[ i ];
				const morphTargetNode = deformerNodes[ child.ID ];
				const rawMorphTarget = {
					name: morphTargetNode.attrName,
					initialWeight: morphTargetNode.DeformPercent,
					id: morphTargetNode.id,
					fullWeights: morphTargetNode.FullWeights.a
				};
				if ( morphTargetNode.attrType !== 'BlendShapeChannel' ) return;
				rawMorphTarget.geoID = connections.get( parseInt( child.ID ) ).children.filter( function ( child ) {

					return child.relationship === undefined;

				} )[ 0 ].ID;
				rawMorphTargets.push( rawMorphTarget );

			}

			return rawMorphTargets;

		} // create the main THREE.Group() to be returned by the loader


		parseScene( deformers, geometryMap, materialMap ) {

			sceneGraph = new THREE.Group();
			const modelMap = this.parseModels( deformers.skeletons, geometryMap, materialMap );
			const modelNodes = fbxTree.Objects.Model;
			const scope = this;
			modelMap.forEach( function ( model ) {

				const modelNode = modelNodes[ model.ID ];
				scope.setLookAtProperties( model, modelNode );
				const parentConnections = connections.get( model.ID ).parents;
				parentConnections.forEach( function ( connection ) {

					const parent = modelMap.get( connection.ID );
					if ( parent !== undefined ) parent.add( model );

				} );

				if ( model.parent === null ) {

					sceneGraph.add( model );

				}

			} );
			this.bindSkeleton( deformers.skeletons, geometryMap, modelMap );
			this.createAmbientLight();
			this.setupMorphMaterials();
			sceneGraph.traverse( function ( node ) {

				if ( node.userData.transformData ) {

					if ( node.parent ) {

						node.userData.transformData.parentMatrix = node.parent.matrix;
						node.userData.transformData.parentMatrixWorld = node.parent.matrixWorld;

					}

					const transform = generateTransform( node.userData.transformData );
					node.applyMatrix4( transform );
					node.updateWorldMatrix();

				}

			} );
			const animations = new AnimationParser().parse(); // if all the models where already combined in a single group, just return that

			if ( sceneGraph.children.length === 1 && sceneGraph.children[ 0 ].isGroup ) {

				sceneGraph.children[ 0 ].animations = animations;
				sceneGraph = sceneGraph.children[ 0 ];

			}

			sceneGraph.animations = animations;

		} // parse nodes in FBXTree.Objects.Model


		parseModels( skeletons, geometryMap, materialMap ) {

			const modelMap = new Map();
			const modelNodes = fbxTree.Objects.Model;

			for ( const nodeID in modelNodes ) {

				const id = parseInt( nodeID );
				const node = modelNodes[ nodeID ];
				const relationships = connections.get( id );
				let model = this.buildSkeleton( relationships, skeletons, id, node.attrName );

				if ( ! model ) {

					switch ( node.attrType ) {

						case 'Camera':
							model = this.createCamera( relationships );
							break;

						case 'Light':
							model = this.createLight( relationships );
							break;

						case 'Mesh':
							model = this.createMesh( relationships, geometryMap, materialMap );
							break;

						case 'NurbsCurve':
							model = this.createCurve( relationships, geometryMap );
							break;

						case 'LimbNode':
						case 'Root':
							model = new THREE.Bone();
							break;

						case 'Null':
						default:
							model = new THREE.Group();
							break;

					}

					model.name = node.attrName ? THREE.PropertyBinding.sanitizeNodeName( node.attrName ) : '';
					model.ID = id;

				}

				this.getTransformData( model, node );
				modelMap.set( id, model );

			}

			return modelMap;

		}

		buildSkeleton( relationships, skeletons, id, name ) {

			let bone = null;
			relationships.parents.forEach( function ( parent ) {

				for ( const ID in skeletons ) {

					const skeleton = skeletons[ ID ];
					skeleton.rawBones.forEach( function ( rawBone, i ) {

						if ( rawBone.ID === parent.ID ) {

							const subBone = bone;
							bone = new THREE.Bone();
							bone.matrixWorld.copy( rawBone.transformLink ); // set name and id here - otherwise in cases where "subBone" is created it will not have a name / id

							bone.name = name ? THREE.PropertyBinding.sanitizeNodeName( name ) : '';
							bone.ID = id;
							skeleton.bones[ i ] = bone; // In cases where a bone is shared between multiple meshes
							// duplicate the bone here and and it as a child of the first bone

							if ( subBone !== null ) {

								bone.add( subBone );

							}

						}

					} );

				}

			} );
			return bone;

		} // create a THREE.PerspectiveCamera or THREE.OrthographicCamera


		createCamera( relationships ) {

			let model;
			let cameraAttribute;
			relationships.children.forEach( function ( child ) {

				const attr = fbxTree.Objects.NodeAttribute[ child.ID ];

				if ( attr !== undefined ) {

					cameraAttribute = attr;

				}

			} );

			if ( cameraAttribute === undefined ) {

				model = new THREE.Object3D();

			} else {

				let type = 0;

				if ( cameraAttribute.CameraProjectionType !== undefined && cameraAttribute.CameraProjectionType.value === 1 ) {

					type = 1;

				}

				let nearClippingPlane = 1;

				if ( cameraAttribute.NearPlane !== undefined ) {

					nearClippingPlane = cameraAttribute.NearPlane.value / 1000;

				}

				let farClippingPlane = 1000;

				if ( cameraAttribute.FarPlane !== undefined ) {

					farClippingPlane = cameraAttribute.FarPlane.value / 1000;

				}

				let width = window.innerWidth;
				let height = window.innerHeight;

				if ( cameraAttribute.AspectWidth !== undefined && cameraAttribute.AspectHeight !== undefined ) {

					width = cameraAttribute.AspectWidth.value;
					height = cameraAttribute.AspectHeight.value;

				}

				const aspect = width / height;
				let fov = 45;

				if ( cameraAttribute.FieldOfView !== undefined ) {

					fov = cameraAttribute.FieldOfView.value;

				}

				const focalLength = cameraAttribute.FocalLength ? cameraAttribute.FocalLength.value : null;

				switch ( type ) {

					case 0:
						// Perspective
						model = new THREE.PerspectiveCamera( fov, aspect, nearClippingPlane, farClippingPlane );
						if ( focalLength !== null ) model.setFocalLength( focalLength );
						break;

					case 1:
						// Orthographic
						model = new THREE.OrthographicCamera( - width / 2, width / 2, height / 2, - height / 2, nearClippingPlane, farClippingPlane );
						break;

					default:
						console.warn( 'THREE.FBXLoader: Unknown camera type ' + type + '.' );
						model = new THREE.Object3D();
						break;

				}

			}

			return model;

		} // Create a THREE.DirectionalLight, THREE.PointLight or THREE.SpotLight


		createLight( relationships ) {

			let model;
			let lightAttribute;
			relationships.children.forEach( function ( child ) {

				const attr = fbxTree.Objects.NodeAttribute[ child.ID ];

				if ( attr !== undefined ) {

					lightAttribute = attr;

				}

			} );

			if ( lightAttribute === undefined ) {

				model = new THREE.Object3D();

			} else {

				let type; // LightType can be undefined for Point lights

				if ( lightAttribute.LightType === undefined ) {

					type = 0;

				} else {

					type = lightAttribute.LightType.value;

				}

				let color = 0xffffff;

				if ( lightAttribute.Color !== undefined ) {

					color = new THREE.Color().fromArray( lightAttribute.Color.value );

				}

				let intensity = lightAttribute.Intensity === undefined ? 1 : lightAttribute.Intensity.value / 100; // light disabled

				if ( lightAttribute.CastLightOnObject !== undefined && lightAttribute.CastLightOnObject.value === 0 ) {

					intensity = 0;

				}

				let distance = 0;

				if ( lightAttribute.FarAttenuationEnd !== undefined ) {

					if ( lightAttribute.EnableFarAttenuation !== undefined && lightAttribute.EnableFarAttenuation.value === 0 ) {

						distance = 0;

					} else {

						distance = lightAttribute.FarAttenuationEnd.value;

					}

				} // TODO: could this be calculated linearly from FarAttenuationStart to FarAttenuationEnd?


				const decay = 1;

				switch ( type ) {

					case 0:
						// Point
						model = new THREE.PointLight( color, intensity, distance, decay );
						break;

					case 1:
						// Directional
						model = new THREE.DirectionalLight( color, intensity );
						break;

					case 2:
						// Spot
						let angle = Math.PI / 3;

						if ( lightAttribute.InnerAngle !== undefined ) {

							angle = THREE.MathUtils.degToRad( lightAttribute.InnerAngle.value );

						}

						let penumbra = 0;

						if ( lightAttribute.OuterAngle !== undefined ) {

							// TODO: this is not correct - FBX calculates outer and inner angle in degrees
							// with OuterAngle > InnerAngle && OuterAngle <= Math.PI
							// while three.js uses a penumbra between (0, 1) to attenuate the inner angle
							penumbra = THREE.MathUtils.degToRad( lightAttribute.OuterAngle.value );
							penumbra = Math.max( penumbra, 1 );

						}

						model = new THREE.SpotLight( color, intensity, distance, angle, penumbra, decay );
						break;

					default:
						console.warn( 'THREE.FBXLoader: Unknown light type ' + lightAttribute.LightType.value + ', defaulting to a THREE.PointLight.' );
						model = new THREE.PointLight( color, intensity );
						break;

				}

				if ( lightAttribute.CastShadows !== undefined && lightAttribute.CastShadows.value === 1 ) {

					model.castShadow = true;

				}

			}

			return model;

		}

		createMesh( relationships, geometryMap, materialMap ) {

			let model;
			let geometry = null;
			let material = null;
			const materials = []; // get geometry and materials(s) from connections

			relationships.children.forEach( function ( child ) {

				if ( geometryMap.has( child.ID ) ) {

					geometry = geometryMap.get( child.ID );

				}

				if ( materialMap.has( child.ID ) ) {

					materials.push( materialMap.get( child.ID ) );

				}

			} );

			if ( materials.length > 1 ) {

				material = materials;

			} else if ( materials.length > 0 ) {

				material = materials[ 0 ];

			} else {

				material = new THREE.MeshPhongMaterial( {
					color: 0xcccccc
				} );
				materials.push( material );

			}

			if ( 'color' in geometry.attributes ) {

				materials.forEach( function ( material ) {

					material.vertexColors = true;

				} );

			}

			if ( geometry.FBX_Deformer ) {

				model = new THREE.SkinnedMesh( geometry, material );
				model.normalizeSkinWeights();

			} else {

				model = new THREE.Mesh( geometry, material );

			}

			return model;

		}

		createCurve( relationships, geometryMap ) {

			const geometry = relationships.children.reduce( function ( geo, child ) {

				if ( geometryMap.has( child.ID ) ) geo = geometryMap.get( child.ID );
				return geo;

			}, null ); // FBX does not list materials for Nurbs lines, so we'll just put our own in here.

			const material = new THREE.LineBasicMaterial( {
				color: 0x3300ff,
				linewidth: 1
			} );
			return new THREE.Line( geometry, material );

		} // parse the model node for transform data


		getTransformData( model, modelNode ) {

			const transformData = {};
			if ( 'InheritType' in modelNode ) transformData.inheritType = parseInt( modelNode.InheritType.value );
			if ( 'RotationOrder' in modelNode ) transformData.eulerOrder = getEulerOrder( modelNode.RotationOrder.value ); else transformData.eulerOrder = 'ZYX';
			if ( 'Lcl_Translation' in modelNode ) transformData.translation = modelNode.Lcl_Translation.value;
			if ( 'PreRotation' in modelNode ) transformData.preRotation = modelNode.PreRotation.value;
			if ( 'Lcl_Rotation' in modelNode ) transformData.rotation = modelNode.Lcl_Rotation.value;
			if ( 'PostRotation' in modelNode ) transformData.postRotation = modelNode.PostRotation.value;
			if ( 'Lcl_Scaling' in modelNode ) transformData.scale = modelNode.Lcl_Scaling.value;
			if ( 'ScalingOffset' in modelNode ) transformData.scalingOffset = modelNode.ScalingOffset.value;
			if ( 'ScalingPivot' in modelNode ) transformData.scalingPivot = modelNode.ScalingPivot.value;
			if ( 'RotationOffset' in modelNode ) transformData.rotationOffset = modelNode.RotationOffset.value;
			if ( 'RotationPivot' in modelNode ) transformData.rotationPivot = modelNode.RotationPivot.value;
			model.userData.transformData = transformData;

		}

		setLookAtProperties( model, modelNode ) {

			if ( 'LookAtProperty' in modelNode ) {

				const children = connections.get( model.ID ).children;
				children.forEach( function ( child ) {

					if ( child.relationship === 'LookAtProperty' ) {

						const lookAtTarget = fbxTree.Objects.Model[ child.ID ];

						if ( 'Lcl_Translation' in lookAtTarget ) {

							const pos = lookAtTarget.Lcl_Translation.value; // THREE.DirectionalLight, THREE.SpotLight

							if ( model.target !== undefined ) {

								model.target.position.fromArray( pos );
								sceneGraph.add( model.target );

							} else {

								// Cameras and other Object3Ds
								model.lookAt( new THREE.Vector3().fromArray( pos ) );

							}

						}

					}

				} );

			}

		}

		bindSkeleton( skeletons, geometryMap, modelMap ) {

			const bindMatrices = this.parsePoseNodes();

			for ( const ID in skeletons ) {

				const skeleton = skeletons[ ID ];
				const parents = connections.get( parseInt( skeleton.ID ) ).parents;
				parents.forEach( function ( parent ) {

					if ( geometryMap.has( parent.ID ) ) {

						const geoID = parent.ID;
						const geoRelationships = connections.get( geoID );
						geoRelationships.parents.forEach( function ( geoConnParent ) {

							if ( modelMap.has( geoConnParent.ID ) ) {

								const model = modelMap.get( geoConnParent.ID );
								model.bind( new THREE.Skeleton( skeleton.bones ), bindMatrices[ geoConnParent.ID ] );

							}

						} );

					}

				} );

			}

		}

		parsePoseNodes() {

			const bindMatrices = {};

			if ( 'Pose' in fbxTree.Objects ) {

				const BindPoseNode = fbxTree.Objects.Pose;

				for ( const nodeID in BindPoseNode ) {

					if ( BindPoseNode[ nodeID ].attrType === 'BindPose' ) {

						const poseNodes = BindPoseNode[ nodeID ].PoseNode;

						if ( Array.isArray( poseNodes ) ) {

							poseNodes.forEach( function ( poseNode ) {

								bindMatrices[ poseNode.Node ] = new THREE.Matrix4().fromArray( poseNode.Matrix.a );

							} );

						} else {

							bindMatrices[ poseNodes.Node ] = new THREE.Matrix4().fromArray( poseNodes.Matrix.a );

						}

					}

				}

			}

			return bindMatrices;

		} // Parse ambient color in FBXTree.GlobalSettings - if it's not set to black (default), create an ambient light


		createAmbientLight() {

			if ( 'GlobalSettings' in fbxTree && 'AmbientColor' in fbxTree.GlobalSettings ) {

				const ambientColor = fbxTree.GlobalSettings.AmbientColor.value;
				const r = ambientColor[ 0 ];
				const g = ambientColor[ 1 ];
				const b = ambientColor[ 2 ];

				if ( r !== 0 || g !== 0 || b !== 0 ) {

					const color = new THREE.Color( r, g, b );
					sceneGraph.add( new THREE.AmbientLight( color, 1 ) );

				}

			}

		}

		setupMorphMaterials() {

			const scope = this;
			sceneGraph.traverse( function ( child ) {

				if ( child.isMesh ) {

					if ( child.geometry.morphAttributes.position && child.geometry.morphAttributes.position.length ) {

						if ( Array.isArray( child.material ) ) {

							child.material.forEach( function ( material, i ) {

								scope.setupMorphMaterial( child, material, i );

							} );

						} else {

							scope.setupMorphMaterial( child, child.material );

						}

					}

				}

			} );

		}

		setupMorphMaterial( child, material, index ) {

			const uuid = child.uuid;
			const matUuid = material.uuid; // if a geometry has morph targets, it cannot share the material with other geometries

			let sharedMat = false;
			sceneGraph.traverse( function ( node ) {

				if ( node.isMesh ) {

					if ( Array.isArray( node.material ) ) {

						node.material.forEach( function ( mat ) {

							if ( mat.uuid === matUuid && node.uuid !== uuid ) sharedMat = true;

						} );

					} else if ( node.material.uuid === matUuid && node.uuid !== uuid ) sharedMat = true;

				}

			} );

			if ( sharedMat === true ) {

				const clonedMat = material.clone();
				clonedMat.morphTargets = true;
				if ( index === undefined ) child.material = clonedMat; else child.material[ index ] = clonedMat;

			} else material.morphTargets = true;

		}

	} // parse Geometry data from FBXTree and return map of BufferGeometries


	class GeometryParser {

		// Parse nodes in FBXTree.Objects.Geometry
		parse( deformers ) {

			const geometryMap = new Map();

			if ( 'Geometry' in fbxTree.Objects ) {

				const geoNodes = fbxTree.Objects.Geometry;

				for ( const nodeID in geoNodes ) {

					const relationships = connections.get( parseInt( nodeID ) );
					const geo = this.parseGeometry( relationships, geoNodes[ nodeID ], deformers );
					geometryMap.set( parseInt( nodeID ), geo );

				}

			}

			return geometryMap;

		} // Parse single node in FBXTree.Objects.Geometry


		parseGeometry( relationships, geoNode, deformers ) {

			switch ( geoNode.attrType ) {

				case 'Mesh':
					return this.parseMeshGeometry( relationships, geoNode, deformers );
					break;

				case 'NurbsCurve':
					return this.parseNurbsGeometry( geoNode );
					break;

			}

		} // Parse single node mesh geometry in FBXTree.Objects.Geometry


		parseMeshGeometry( relationships, geoNode, deformers ) {

			const skeletons = deformers.skeletons;
			const morphTargets = [];
			const modelNodes = relationships.parents.map( function ( parent ) {

				return fbxTree.Objects.Model[ parent.ID ];

			} ); // don't create geometry if it is not associated with any models

			if ( modelNodes.length === 0 ) return;
			const skeleton = relationships.children.reduce( function ( skeleton, child ) {

				if ( skeletons[ child.ID ] !== undefined ) skeleton = skeletons[ child.ID ];
				return skeleton;

			}, null );
			relationships.children.forEach( function ( child ) {

				if ( deformers.morphTargets[ child.ID ] !== undefined ) {

					morphTargets.push( deformers.morphTargets[ child.ID ] );

				}

			} ); // Assume one model and get the preRotation from that
			// if there is more than one model associated with the geometry this may cause problems

			const modelNode = modelNodes[ 0 ];
			const transformData = {};
			if ( 'RotationOrder' in modelNode ) transformData.eulerOrder = getEulerOrder( modelNode.RotationOrder.value );
			if ( 'InheritType' in modelNode ) transformData.inheritType = parseInt( modelNode.InheritType.value );
			if ( 'GeometricTranslation' in modelNode ) transformData.translation = modelNode.GeometricTranslation.value;
			if ( 'GeometricRotation' in modelNode ) transformData.rotation = modelNode.GeometricRotation.value;
			if ( 'GeometricScaling' in modelNode ) transformData.scale = modelNode.GeometricScaling.value;
			const transform = generateTransform( transformData );
			return this.genGeometry( geoNode, skeleton, morphTargets, transform );

		} // Generate a THREE.BufferGeometry from a node in FBXTree.Objects.Geometry


		genGeometry( geoNode, skeleton, morphTargets, preTransform ) {

			const geo = new THREE.BufferGeometry();
			if ( geoNode.attrName ) geo.name = geoNode.attrName;
			const geoInfo = this.parseGeoNode( geoNode, skeleton );
			const buffers = this.genBuffers( geoInfo );
			const positionAttribute = new THREE.Float32BufferAttribute( buffers.vertex, 3 );
			positionAttribute.applyMatrix4( preTransform );
			geo.setAttribute( 'position', positionAttribute );

			if ( buffers.colors.length > 0 ) {

				geo.setAttribute( 'color', new THREE.Float32BufferAttribute( buffers.colors, 3 ) );

			}

			if ( skeleton ) {

				geo.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( buffers.weightsIndices, 4 ) );
				geo.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( buffers.vertexWeights, 4 ) ); // used later to bind the skeleton to the model

				geo.FBX_Deformer = skeleton;

			}

			if ( buffers.normal.length > 0 ) {

				const normalMatrix = new THREE.Matrix3().getNormalMatrix( preTransform );
				const normalAttribute = new THREE.Float32BufferAttribute( buffers.normal, 3 );
				normalAttribute.applyNormalMatrix( normalMatrix );
				geo.setAttribute( 'normal', normalAttribute );

			}

			buffers.uvs.forEach( function ( uvBuffer, i ) {

				// subsequent uv buffers are called 'uv1', 'uv2', ...
				let name = 'uv' + ( i + 1 ).toString(); // the first uv buffer is just called 'uv'

				if ( i === 0 ) {

					name = 'uv';

				}

				geo.setAttribute( name, new THREE.Float32BufferAttribute( buffers.uvs[ i ], 2 ) );

			} );

			if ( geoInfo.material && geoInfo.material.mappingType !== 'AllSame' ) {

				// Convert the material indices of each vertex into rendering groups on the geometry.
				let prevMaterialIndex = buffers.materialIndex[ 0 ];
				let startIndex = 0;
				buffers.materialIndex.forEach( function ( currentIndex, i ) {

					if ( currentIndex !== prevMaterialIndex ) {

						geo.addGroup( startIndex, i - startIndex, prevMaterialIndex );
						prevMaterialIndex = currentIndex;
						startIndex = i;

					}

				} ); // the loop above doesn't add the last group, do that here.

				if ( geo.groups.length > 0 ) {

					const lastGroup = geo.groups[ geo.groups.length - 1 ];
					const lastIndex = lastGroup.start + lastGroup.count;

					if ( lastIndex !== buffers.materialIndex.length ) {

						geo.addGroup( lastIndex, buffers.materialIndex.length - lastIndex, prevMaterialIndex );

					}

				} // case where there are multiple materials but the whole geometry is only
				// using one of them


				if ( geo.groups.length === 0 ) {

					geo.addGroup( 0, buffers.materialIndex.length, buffers.materialIndex[ 0 ] );

				}

			}

			this.addMorphTargets( geo, geoNode, morphTargets, preTransform );
			return geo;

		}

		parseGeoNode( geoNode, skeleton ) {

			const geoInfo = {};
			geoInfo.vertexPositions = geoNode.Vertices !== undefined ? geoNode.Vertices.a : [];
			geoInfo.vertexIndices = geoNode.PolygonVertexIndex !== undefined ? geoNode.PolygonVertexIndex.a : [];

			if ( geoNode.LayerElementColor ) {

				geoInfo.color = this.parseVertexColors( geoNode.LayerElementColor[ 0 ] );

			}

			if ( geoNode.LayerElementMaterial ) {

				geoInfo.material = this.parseMaterialIndices( geoNode.LayerElementMaterial[ 0 ] );

			}

			if ( geoNode.LayerElementNormal ) {

				geoInfo.normal = this.parseNormals( geoNode.LayerElementNormal[ 0 ] );

			}

			if ( geoNode.LayerElementUV ) {

				geoInfo.uv = [];
				let i = 0;

				while ( geoNode.LayerElementUV[ i ] ) {

					if ( geoNode.LayerElementUV[ i ].UV ) {

						geoInfo.uv.push( this.parseUVs( geoNode.LayerElementUV[ i ] ) );

					}

					i ++;

				}

			}

			geoInfo.weightTable = {};

			if ( skeleton !== null ) {

				geoInfo.skeleton = skeleton;
				skeleton.rawBones.forEach( function ( rawBone, i ) {

					// loop over the bone's vertex indices and weights
					rawBone.indices.forEach( function ( index, j ) {

						if ( geoInfo.weightTable[ index ] === undefined ) geoInfo.weightTable[ index ] = [];
						geoInfo.weightTable[ index ].push( {
							id: i,
							weight: rawBone.weights[ j ]
						} );

					} );

				} );

			}

			return geoInfo;

		}

		genBuffers( geoInfo ) {

			const buffers = {
				vertex: [],
				normal: [],
				colors: [],
				uvs: [],
				materialIndex: [],
				vertexWeights: [],
				weightsIndices: []
			};
			let polygonIndex = 0;
			let faceLength = 0;
			let displayedWeightsWarning = false; // these will hold data for a single face

			let facePositionIndexes = [];
			let faceNormals = [];
			let faceColors = [];
			let faceUVs = [];
			let faceWeights = [];
			let faceWeightIndices = [];
			const scope = this;
			geoInfo.vertexIndices.forEach( function ( vertexIndex, polygonVertexIndex ) {

				let materialIndex;
				let endOfFace = false; // Face index and vertex index arrays are combined in a single array
				// A cube with quad faces looks like this:
				// PolygonVertexIndex: *24 {
				//  a: 0, 1, 3, -3, 2, 3, 5, -5, 4, 5, 7, -7, 6, 7, 1, -1, 1, 7, 5, -4, 6, 0, 2, -5
				//  }
				// Negative numbers mark the end of a face - first face here is 0, 1, 3, -3
				// to find index of last vertex bit shift the index: ^ - 1

				if ( vertexIndex < 0 ) {

					vertexIndex = vertexIndex ^ - 1; // equivalent to ( x * -1 ) - 1

					endOfFace = true;

				}

				let weightIndices = [];
				let weights = [];
				facePositionIndexes.push( vertexIndex * 3, vertexIndex * 3 + 1, vertexIndex * 3 + 2 );

				if ( geoInfo.color ) {

					const data = getData( polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.color );
					faceColors.push( data[ 0 ], data[ 1 ], data[ 2 ] );

				}

				if ( geoInfo.skeleton ) {

					if ( geoInfo.weightTable[ vertexIndex ] !== undefined ) {

						geoInfo.weightTable[ vertexIndex ].forEach( function ( wt ) {

							weights.push( wt.weight );
							weightIndices.push( wt.id );

						} );

					}

					if ( weights.length > 4 ) {

						if ( ! displayedWeightsWarning ) {

							console.warn( 'THREE.FBXLoader: Vertex has more than 4 skinning weights assigned to vertex. Deleting additional weights.' );
							displayedWeightsWarning = true;

						}

						const wIndex = [ 0, 0, 0, 0 ];
						const Weight = [ 0, 0, 0, 0 ];
						weights.forEach( function ( weight, weightIndex ) {

							let currentWeight = weight;
							let currentIndex = weightIndices[ weightIndex ];
							Weight.forEach( function ( comparedWeight, comparedWeightIndex, comparedWeightArray ) {

								if ( currentWeight > comparedWeight ) {

									comparedWeightArray[ comparedWeightIndex ] = currentWeight;
									currentWeight = comparedWeight;
									const tmp = wIndex[ comparedWeightIndex ];
									wIndex[ comparedWeightIndex ] = currentIndex;
									currentIndex = tmp;

								}

							} );

						} );
						weightIndices = wIndex;
						weights = Weight;

					} // if the weight array is shorter than 4 pad with 0s


					while ( weights.length < 4 ) {

						weights.push( 0 );
						weightIndices.push( 0 );

					}

					for ( let i = 0; i < 4; ++ i ) {

						faceWeights.push( weights[ i ] );
						faceWeightIndices.push( weightIndices[ i ] );

					}

				}

				if ( geoInfo.normal ) {

					const data = getData( polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.normal );
					faceNormals.push( data[ 0 ], data[ 1 ], data[ 2 ] );

				}

				if ( geoInfo.material && geoInfo.material.mappingType !== 'AllSame' ) {

					materialIndex = getData( polygonVertexIndex, polygonIndex, vertexIndex, geoInfo.material )[ 0 ];

				}

				if ( geoInfo.uv ) {

					geoInfo.uv.forEach( function ( uv, i ) {

						const data = getData( polygonVertexIndex, polygonIndex, vertexIndex, uv );

						if ( faceUVs[ i ] === undefined ) {

							faceUVs[ i ] = [];

						}

						faceUVs[ i ].push( data[ 0 ] );
						faceUVs[ i ].push( data[ 1 ] );

					} );

				}

				faceLength ++;

				if ( endOfFace ) {

					scope.genFace( buffers, geoInfo, facePositionIndexes, materialIndex, faceNormals, faceColors, faceUVs, faceWeights, faceWeightIndices, faceLength );
					polygonIndex ++;
					faceLength = 0; // reset arrays for the next face

					facePositionIndexes = [];
					faceNormals = [];
					faceColors = [];
					faceUVs = [];
					faceWeights = [];
					faceWeightIndices = [];

				}

			} );
			return buffers;

		} // Generate data for a single face in a geometry. If the face is a quad then split it into 2 tris


		genFace( buffers, geoInfo, facePositionIndexes, materialIndex, faceNormals, faceColors, faceUVs, faceWeights, faceWeightIndices, faceLength ) {

			for ( let i = 2; i < faceLength; i ++ ) {

				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ 0 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ 1 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ 2 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ ( i - 1 ) * 3 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ ( i - 1 ) * 3 + 1 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ ( i - 1 ) * 3 + 2 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ i * 3 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ i * 3 + 1 ] ] );
				buffers.vertex.push( geoInfo.vertexPositions[ facePositionIndexes[ i * 3 + 2 ] ] );

				if ( geoInfo.skeleton ) {

					buffers.vertexWeights.push( faceWeights[ 0 ] );
					buffers.vertexWeights.push( faceWeights[ 1 ] );
					buffers.vertexWeights.push( faceWeights[ 2 ] );
					buffers.vertexWeights.push( faceWeights[ 3 ] );
					buffers.vertexWeights.push( faceWeights[ ( i - 1 ) * 4 ] );
					buffers.vertexWeights.push( faceWeights[ ( i - 1 ) * 4 + 1 ] );
					buffers.vertexWeights.push( faceWeights[ ( i - 1 ) * 4 + 2 ] );
					buffers.vertexWeights.push( faceWeights[ ( i - 1 ) * 4 + 3 ] );
					buffers.vertexWeights.push( faceWeights[ i * 4 ] );
					buffers.vertexWeights.push( faceWeights[ i * 4 + 1 ] );
					buffers.vertexWeights.push( faceWeights[ i * 4 + 2 ] );
					buffers.vertexWeights.push( faceWeights[ i * 4 + 3 ] );
					buffers.weightsIndices.push( faceWeightIndices[ 0 ] );
					buffers.weightsIndices.push( faceWeightIndices[ 1 ] );
					buffers.weightsIndices.push( faceWeightIndices[ 2 ] );
					buffers.weightsIndices.push( faceWeightIndices[ 3 ] );
					buffers.weightsIndices.push( faceWeightIndices[ ( i - 1 ) * 4 ] );
					buffers.weightsIndices.push( faceWeightIndices[ ( i - 1 ) * 4 + 1 ] );
					buffers.weightsIndices.push( faceWeightIndices[ ( i - 1 ) * 4 + 2 ] );
					buffers.weightsIndices.push( faceWeightIndices[ ( i - 1 ) * 4 + 3 ] );
					buffers.weightsIndices.push( faceWeightIndices[ i * 4 ] );
					buffers.weightsIndices.push( faceWeightIndices[ i * 4 + 1 ] );
					buffers.weightsIndices.push( faceWeightIndices[ i * 4 + 2 ] );
					buffers.weightsIndices.push( faceWeightIndices[ i * 4 + 3 ] );

				}

				if ( geoInfo.color ) {

					buffers.colors.push( faceColors[ 0 ] );
					buffers.colors.push( faceColors[ 1 ] );
					buffers.colors.push( faceColors[ 2 ] );
					buffers.colors.push( faceColors[ ( i - 1 ) * 3 ] );
					buffers.colors.push( faceColors[ ( i - 1 ) * 3 + 1 ] );
					buffers.colors.push( faceColors[ ( i - 1 ) * 3 + 2 ] );
					buffers.colors.push( faceColors[ i * 3 ] );
					buffers.colors.push( faceColors[ i * 3 + 1 ] );
					buffers.colors.push( faceColors[ i * 3 + 2 ] );

				}

				if ( geoInfo.material && geoInfo.material.mappingType !== 'AllSame' ) {

					buffers.materialIndex.push( materialIndex );
					buffers.materialIndex.push( materialIndex );
					buffers.materialIndex.push( materialIndex );

				}

				if ( geoInfo.normal ) {

					buffers.normal.push( faceNormals[ 0 ] );
					buffers.normal.push( faceNormals[ 1 ] );
					buffers.normal.push( faceNormals[ 2 ] );
					buffers.normal.push( faceNormals[ ( i - 1 ) * 3 ] );
					buffers.normal.push( faceNormals[ ( i - 1 ) * 3 + 1 ] );
					buffers.normal.push( faceNormals[ ( i - 1 ) * 3 + 2 ] );
					buffers.normal.push( faceNormals[ i * 3 ] );
					buffers.normal.push( faceNormals[ i * 3 + 1 ] );
					buffers.normal.push( faceNormals[ i * 3 + 2 ] );

				}

				if ( geoInfo.uv ) {

					geoInfo.uv.forEach( function ( uv, j ) {

						if ( buffers.uvs[ j ] === undefined ) buffers.uvs[ j ] = [];
						buffers.uvs[ j ].push( faceUVs[ j ][ 0 ] );
						buffers.uvs[ j ].push( faceUVs[ j ][ 1 ] );
						buffers.uvs[ j ].push( faceUVs[ j ][ ( i - 1 ) * 2 ] );
						buffers.uvs[ j ].push( faceUVs[ j ][ ( i - 1 ) * 2 + 1 ] );
						buffers.uvs[ j ].push( faceUVs[ j ][ i * 2 ] );
						buffers.uvs[ j ].push( faceUVs[ j ][ i * 2 + 1 ] );

					} );

				}

			}

		}

		addMorphTargets( parentGeo, parentGeoNode, morphTargets, preTransform ) {

			if ( morphTargets.length === 0 ) return;
			parentGeo.morphTargetsRelative = true;
			parentGeo.morphAttributes.position = []; // parentGeo.morphAttributes.normal = []; // not implemented

			const scope = this;
			morphTargets.forEach( function ( morphTarget ) {

				morphTarget.rawTargets.forEach( function ( rawTarget ) {

					const morphGeoNode = fbxTree.Objects.Geometry[ rawTarget.geoID ];

					if ( morphGeoNode !== undefined ) {

						scope.genMorphGeometry( parentGeo, parentGeoNode, morphGeoNode, preTransform, rawTarget.name );

					}

				} );

			} );

		} // a morph geometry node is similar to a standard  node, and the node is also contained
		// in FBXTree.Objects.Geometry, however it can only have attributes for position, normal
		// and a special attribute Index defining which vertices of the original geometry are affected
		// Normal and position attributes only have data for the vertices that are affected by the morph


		genMorphGeometry( parentGeo, parentGeoNode, morphGeoNode, preTransform, name ) {

			const vertexIndices = parentGeoNode.PolygonVertexIndex !== undefined ? parentGeoNode.PolygonVertexIndex.a : [];
			const morphPositionsSparse = morphGeoNode.Vertices !== undefined ? morphGeoNode.Vertices.a : [];
			const indices = morphGeoNode.Indexes !== undefined ? morphGeoNode.Indexes.a : [];
			const length = parentGeo.attributes.position.count * 3;
			const morphPositions = new Float32Array( length );

			for ( let i = 0; i < indices.length; i ++ ) {

				const morphIndex = indices[ i ] * 3;
				morphPositions[ morphIndex ] = morphPositionsSparse[ i * 3 ];
				morphPositions[ morphIndex + 1 ] = morphPositionsSparse[ i * 3 + 1 ];
				morphPositions[ morphIndex + 2 ] = morphPositionsSparse[ i * 3 + 2 ];

			} // TODO: add morph normal support


			const morphGeoInfo = {
				vertexIndices: vertexIndices,
				vertexPositions: morphPositions
			};
			const morphBuffers = this.genBuffers( morphGeoInfo );
			const positionAttribute = new THREE.Float32BufferAttribute( morphBuffers.vertex, 3 );
			positionAttribute.name = name || morphGeoNode.attrName;
			positionAttribute.applyMatrix4( preTransform );
			parentGeo.morphAttributes.position.push( positionAttribute );

		} // Parse normal from FBXTree.Objects.Geometry.LayerElementNormal if it exists


		parseNormals( NormalNode ) {

			const mappingType = NormalNode.MappingInformationType;
			const referenceType = NormalNode.ReferenceInformationType;
			const buffer = NormalNode.Normals.a;
			let indexBuffer = [];

			if ( referenceType === 'IndexToDirect' ) {

				if ( 'NormalIndex' in NormalNode ) {

					indexBuffer = NormalNode.NormalIndex.a;

				} else if ( 'NormalsIndex' in NormalNode ) {

					indexBuffer = NormalNode.NormalsIndex.a;

				}

			}

			return {
				dataSize: 3,
				buffer: buffer,
				indices: indexBuffer,
				mappingType: mappingType,
				referenceType: referenceType
			};

		} // Parse UVs from FBXTree.Objects.Geometry.LayerElementUV if it exists


		parseUVs( UVNode ) {

			const mappingType = UVNode.MappingInformationType;
			const referenceType = UVNode.ReferenceInformationType;
			const buffer = UVNode.UV.a;
			let indexBuffer = [];

			if ( referenceType === 'IndexToDirect' ) {

				indexBuffer = UVNode.UVIndex.a;

			}

			return {
				dataSize: 2,
				buffer: buffer,
				indices: indexBuffer,
				mappingType: mappingType,
				referenceType: referenceType
			};

		} // Parse Vertex Colors from FBXTree.Objects.Geometry.LayerElementColor if it exists


		parseVertexColors( ColorNode ) {

			const mappingType = ColorNode.MappingInformationType;
			const referenceType = ColorNode.ReferenceInformationType;
			const buffer = ColorNode.Colors.a;
			let indexBuffer = [];

			if ( referenceType === 'IndexToDirect' ) {

				indexBuffer = ColorNode.ColorIndex.a;

			}

			return {
				dataSize: 4,
				buffer: buffer,
				indices: indexBuffer,
				mappingType: mappingType,
				referenceType: referenceType
			};

		} // Parse mapping and material data in FBXTree.Objects.Geometry.LayerElementMaterial if it exists


		parseMaterialIndices( MaterialNode ) {

			const mappingType = MaterialNode.MappingInformationType;
			const referenceType = MaterialNode.ReferenceInformationType;

			if ( mappingType === 'NoMappingInformation' ) {

				return {
					dataSize: 1,
					buffer: [ 0 ],
					indices: [ 0 ],
					mappingType: 'AllSame',
					referenceType: referenceType
				};

			}

			const materialIndexBuffer = MaterialNode.Materials.a; // Since materials are stored as indices, there's a bit of a mismatch between FBX and what
			// we expect.So we create an intermediate buffer that points to the index in the buffer,
			// for conforming with the other functions we've written for other data.

			const materialIndices = [];

			for ( let i = 0; i < materialIndexBuffer.length; ++ i ) {

				materialIndices.push( i );

			}

			return {
				dataSize: 1,
				buffer: materialIndexBuffer,
				indices: materialIndices,
				mappingType: mappingType,
				referenceType: referenceType
			};

		} // Generate a NurbGeometry from a node in FBXTree.Objects.Geometry


		parseNurbsGeometry( geoNode ) {

			if ( THREE.NURBSCurve === undefined ) {

				console.error( 'THREE.FBXLoader: The loader relies on THREE.NURBSCurve for any nurbs present in the model. Nurbs will show up as empty geometry.' );
				return new THREE.BufferGeometry();

			}

			const order = parseInt( geoNode.Order );

			if ( isNaN( order ) ) {

				console.error( 'THREE.FBXLoader: Invalid Order %s given for geometry ID: %s', geoNode.Order, geoNode.id );
				return new THREE.BufferGeometry();

			}

			const degree = order - 1;
			const knots = geoNode.KnotVector.a;
			const controlPoints = [];
			const pointsValues = geoNode.Points.a;

			for ( let i = 0, l = pointsValues.length; i < l; i += 4 ) {

				controlPoints.push( new THREE.Vector4().fromArray( pointsValues, i ) );

			}

			let startKnot, endKnot;

			if ( geoNode.Form === 'Closed' ) {

				controlPoints.push( controlPoints[ 0 ] );

			} else if ( geoNode.Form === 'Periodic' ) {

				startKnot = degree;
				endKnot = knots.length - 1 - startKnot;

				for ( let i = 0; i < degree; ++ i ) {

					controlPoints.push( controlPoints[ i ] );

				}

			}

			const curve = new THREE.NURBSCurve( degree, knots, controlPoints, startKnot, endKnot );
			const vertices = curve.getPoints( controlPoints.length * 7 );
			const positions = new Float32Array( vertices.length * 3 );
			vertices.forEach( function ( vertex, i ) {

				vertex.toArray( positions, i * 3 );

			} );
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
			return geometry;

		}

	} // parse animation data from FBXTree


	class AnimationParser {

		// take raw animation clips and turn them into three.js animation clips
		parse() {

			const animationClips = [];
			const rawClips = this.parseClips();

			if ( rawClips !== undefined ) {

				for ( const key in rawClips ) {

					const rawClip = rawClips[ key ];
					const clip = this.addClip( rawClip );
					animationClips.push( clip );

				}

			}

			return animationClips;

		}

		parseClips() {

			// since the actual transformation data is stored in FBXTree.Objects.AnimationCurve,
			// if this is undefined we can safely assume there are no animations
			if ( fbxTree.Objects.AnimationCurve === undefined ) return undefined;
			const curveNodesMap = this.parseAnimationCurveNodes();
			this.parseAnimationCurves( curveNodesMap );
			const layersMap = this.parseAnimationLayers( curveNodesMap );
			const rawClips = this.parseAnimStacks( layersMap );
			return rawClips;

		} // parse nodes in FBXTree.Objects.AnimationCurveNode
		// each AnimationCurveNode holds data for an animation transform for a model (e.g. left arm rotation )
		// and is referenced by an AnimationLayer


		parseAnimationCurveNodes() {

			const rawCurveNodes = fbxTree.Objects.AnimationCurveNode;
			const curveNodesMap = new Map();

			for ( const nodeID in rawCurveNodes ) {

				const rawCurveNode = rawCurveNodes[ nodeID ];

				if ( rawCurveNode.attrName.match( /S|R|T|DeformPercent/ ) !== null ) {

					const curveNode = {
						id: rawCurveNode.id,
						attr: rawCurveNode.attrName,
						curves: {}
					};
					curveNodesMap.set( curveNode.id, curveNode );

				}

			}

			return curveNodesMap;

		} // parse nodes in FBXTree.Objects.AnimationCurve and connect them up to
		// previously parsed AnimationCurveNodes. Each AnimationCurve holds data for a single animated
		// axis ( e.g. times and values of x rotation)


		parseAnimationCurves( curveNodesMap ) {

			const rawCurves = fbxTree.Objects.AnimationCurve; // TODO: Many values are identical up to roundoff error, but won't be optimised
			// e.g. position times: [0, 0.4, 0. 8]
			// position values: [7.23538335023477e-7, 93.67518615722656, -0.9982695579528809, 7.23538335023477e-7, 93.67518615722656, -0.9982695579528809, 7.235384487103147e-7, 93.67520904541016, -0.9982695579528809]
			// clearly, this should be optimised to
			// times: [0], positions [7.23538335023477e-7, 93.67518615722656, -0.9982695579528809]
			// this shows up in nearly every FBX file, and generally time array is length > 100

			for ( const nodeID in rawCurves ) {

				const animationCurve = {
					id: rawCurves[ nodeID ].id,
					times: rawCurves[ nodeID ].KeyTime.a.map( convertFBXTimeToSeconds ),
					values: rawCurves[ nodeID ].KeyValueFloat.a
				};
				const relationships = connections.get( animationCurve.id );

				if ( relationships !== undefined ) {

					const animationCurveID = relationships.parents[ 0 ].ID;
					const animationCurveRelationship = relationships.parents[ 0 ].relationship;

					if ( animationCurveRelationship.match( /X/ ) ) {

						curveNodesMap.get( animationCurveID ).curves[ 'x' ] = animationCurve;

					} else if ( animationCurveRelationship.match( /Y/ ) ) {

						curveNodesMap.get( animationCurveID ).curves[ 'y' ] = animationCurve;

					} else if ( animationCurveRelationship.match( /Z/ ) ) {

						curveNodesMap.get( animationCurveID ).curves[ 'z' ] = animationCurve;

					} else if ( animationCurveRelationship.match( /d|DeformPercent/ ) && curveNodesMap.has( animationCurveID ) ) {

						curveNodesMap.get( animationCurveID ).curves[ 'morph' ] = animationCurve;

					}

				}

			}

		} // parse nodes in FBXTree.Objects.AnimationLayer. Each layers holds references
		// to various AnimationCurveNodes and is referenced by an AnimationStack node
		// note: theoretically a stack can have multiple layers, however in practice there always seems to be one per stack


		parseAnimationLayers( curveNodesMap ) {

			const rawLayers = fbxTree.Objects.AnimationLayer;
			const layersMap = new Map();

			for ( const nodeID in rawLayers ) {

				const layerCurveNodes = [];
				const connection = connections.get( parseInt( nodeID ) );

				if ( connection !== undefined ) {

					// all the animationCurveNodes used in the layer
					const children = connection.children;
					children.forEach( function ( child, i ) {

						if ( curveNodesMap.has( child.ID ) ) {

							const curveNode = curveNodesMap.get( child.ID ); // check that the curves are defined for at least one axis, otherwise ignore the curveNode

							if ( curveNode.curves.x !== undefined || curveNode.curves.y !== undefined || curveNode.curves.z !== undefined ) {

								if ( layerCurveNodes[ i ] === undefined ) {

									const modelID = connections.get( child.ID ).parents.filter( function ( parent ) {

										return parent.relationship !== undefined;

									} )[ 0 ].ID;

									if ( modelID !== undefined ) {

										const rawModel = fbxTree.Objects.Model[ modelID.toString() ];

										if ( rawModel === undefined ) {

											console.warn( 'THREE.FBXLoader: Encountered a unused curve.', child );
											return;

										}

										const node = {
											modelName: rawModel.attrName ? THREE.PropertyBinding.sanitizeNodeName( rawModel.attrName ) : '',
											ID: rawModel.id,
											initialPosition: [ 0, 0, 0 ],
											initialRotation: [ 0, 0, 0 ],
											initialScale: [ 1, 1, 1 ]
										};
										sceneGraph.traverse( function ( child ) {

											if ( child.ID === rawModel.id ) {

												node.transform = child.matrix;
												if ( child.userData.transformData ) node.eulerOrder = child.userData.transformData.eulerOrder;

											}

										} );
										if ( ! node.transform ) node.transform = new THREE.Matrix4(); // if the animated model is pre rotated, we'll have to apply the pre rotations to every
										// animation value as well

										if ( 'PreRotation' in rawModel ) node.preRotation = rawModel.PreRotation.value;
										if ( 'PostRotation' in rawModel ) node.postRotation = rawModel.PostRotation.value;
										layerCurveNodes[ i ] = node;

									}

								}

								if ( layerCurveNodes[ i ] ) layerCurveNodes[ i ][ curveNode.attr ] = curveNode;

							} else if ( curveNode.curves.morph !== undefined ) {

								if ( layerCurveNodes[ i ] === undefined ) {

									const deformerID = connections.get( child.ID ).parents.filter( function ( parent ) {

										return parent.relationship !== undefined;

									} )[ 0 ].ID;
									const morpherID = connections.get( deformerID ).parents[ 0 ].ID;
									const geoID = connections.get( morpherID ).parents[ 0 ].ID; // assuming geometry is not used in more than one model

									const modelID = connections.get( geoID ).parents[ 0 ].ID;
									const rawModel = fbxTree.Objects.Model[ modelID ];
									const node = {
										modelName: rawModel.attrName ? THREE.PropertyBinding.sanitizeNodeName( rawModel.attrName ) : '',
										morphName: fbxTree.Objects.Deformer[ deformerID ].attrName
									};
									layerCurveNodes[ i ] = node;

								}

								layerCurveNodes[ i ][ curveNode.attr ] = curveNode;

							}

						}

					} );
					layersMap.set( parseInt( nodeID ), layerCurveNodes );

				}

			}

			return layersMap;

		} // parse nodes in FBXTree.Objects.AnimationStack. These are the top level node in the animation
		// hierarchy. Each Stack node will be used to create a THREE.AnimationClip


		parseAnimStacks( layersMap ) {

			const rawStacks = fbxTree.Objects.AnimationStack; // connect the stacks (clips) up to the layers

			const rawClips = {};

			for ( const nodeID in rawStacks ) {

				const children = connections.get( parseInt( nodeID ) ).children;

				if ( children.length > 1 ) {

					// it seems like stacks will always be associated with a single layer. But just in case there are files
					// where there are multiple layers per stack, we'll display a warning
					console.warn( 'THREE.FBXLoader: Encountered an animation stack with multiple layers, this is currently not supported. Ignoring subsequent layers.' );

				}

				const layer = layersMap.get( children[ 0 ].ID );
				rawClips[ nodeID ] = {
					name: rawStacks[ nodeID ].attrName,
					layer: layer
				};

			}

			return rawClips;

		}

		addClip( rawClip ) {

			let tracks = [];
			const scope = this;
			rawClip.layer.forEach( function ( rawTracks ) {

				tracks = tracks.concat( scope.generateTracks( rawTracks ) );

			} );
			return new THREE.AnimationClip( rawClip.name, - 1, tracks );

		}

		generateTracks( rawTracks ) {

			const tracks = [];
			let initialPosition = new THREE.Vector3();
			let initialRotation = new THREE.Quaternion();
			let initialScale = new THREE.Vector3();
			if ( rawTracks.transform ) rawTracks.transform.decompose( initialPosition, initialRotation, initialScale );
			initialPosition = initialPosition.toArray();
			initialRotation = new THREE.Euler().setFromQuaternion( initialRotation, rawTracks.eulerOrder ).toArray();
			initialScale = initialScale.toArray();

			if ( rawTracks.T !== undefined && Object.keys( rawTracks.T.curves ).length > 0 ) {

				const positionTrack = this.generateVectorTrack( rawTracks.modelName, rawTracks.T.curves, initialPosition, 'position' );
				if ( positionTrack !== undefined ) tracks.push( positionTrack );

			}

			if ( rawTracks.R !== undefined && Object.keys( rawTracks.R.curves ).length > 0 ) {

				const rotationTrack = this.generateRotationTrack( rawTracks.modelName, rawTracks.R.curves, initialRotation, rawTracks.preRotation, rawTracks.postRotation, rawTracks.eulerOrder );
				if ( rotationTrack !== undefined ) tracks.push( rotationTrack );

			}

			if ( rawTracks.S !== undefined && Object.keys( rawTracks.S.curves ).length > 0 ) {

				const scaleTrack = this.generateVectorTrack( rawTracks.modelName, rawTracks.S.curves, initialScale, 'scale' );
				if ( scaleTrack !== undefined ) tracks.push( scaleTrack );

			}

			if ( rawTracks.DeformPercent !== undefined ) {

				const morphTrack = this.generateMorphTrack( rawTracks );
				if ( morphTrack !== undefined ) tracks.push( morphTrack );

			}

			return tracks;

		}

		generateVectorTrack( modelName, curves, initialValue, type ) {

			const times = this.getTimesForAllAxes( curves );
			const values = this.getKeyframeTrackValues( times, curves, initialValue );
			return new THREE.VectorKeyframeTrack( modelName + '.' + type, times, values );

		}

		generateRotationTrack( modelName, curves, initialValue, preRotation, postRotation, eulerOrder ) {

			if ( curves.x !== undefined ) {

				this.interpolateRotations( curves.x );
				curves.x.values = curves.x.values.map( THREE.MathUtils.degToRad );

			}

			if ( curves.y !== undefined ) {

				this.interpolateRotations( curves.y );
				curves.y.values = curves.y.values.map( THREE.MathUtils.degToRad );

			}

			if ( curves.z !== undefined ) {

				this.interpolateRotations( curves.z );
				curves.z.values = curves.z.values.map( THREE.MathUtils.degToRad );

			}

			const times = this.getTimesForAllAxes( curves );
			const values = this.getKeyframeTrackValues( times, curves, initialValue );

			if ( preRotation !== undefined ) {

				preRotation = preRotation.map( THREE.MathUtils.degToRad );
				preRotation.push( eulerOrder );
				preRotation = new THREE.Euler().fromArray( preRotation );
				preRotation = new THREE.Quaternion().setFromEuler( preRotation );

			}

			if ( postRotation !== undefined ) {

				postRotation = postRotation.map( THREE.MathUtils.degToRad );
				postRotation.push( eulerOrder );
				postRotation = new THREE.Euler().fromArray( postRotation );
				postRotation = new THREE.Quaternion().setFromEuler( postRotation ).invert();

			}

			const quaternion = new THREE.Quaternion();
			const euler = new THREE.Euler();
			const quaternionValues = [];

			for ( let i = 0; i < values.length; i += 3 ) {

				euler.set( values[ i ], values[ i + 1 ], values[ i + 2 ], eulerOrder );
				quaternion.setFromEuler( euler );
				if ( preRotation !== undefined ) quaternion.premultiply( preRotation );
				if ( postRotation !== undefined ) quaternion.multiply( postRotation );
				quaternion.toArray( quaternionValues, i / 3 * 4 );

			}

			return new THREE.QuaternionKeyframeTrack( modelName + '.quaternion', times, quaternionValues );

		}

		generateMorphTrack( rawTracks ) {

			const curves = rawTracks.DeformPercent.curves.morph;
			const values = curves.values.map( function ( val ) {

				return val / 100;

			} );
			const morphNum = sceneGraph.getObjectByName( rawTracks.modelName ).morphTargetDictionary[ rawTracks.morphName ];
			return new THREE.NumberKeyframeTrack( rawTracks.modelName + '.morphTargetInfluences[' + morphNum + ']', curves.times, values );

		} // For all animated objects, times are defined separately for each axis
		// Here we'll combine the times into one sorted array without duplicates


		getTimesForAllAxes( curves ) {

			let times = []; // first join together the times for each axis, if defined

			if ( curves.x !== undefined ) times = times.concat( curves.x.times );
			if ( curves.y !== undefined ) times = times.concat( curves.y.times );
			if ( curves.z !== undefined ) times = times.concat( curves.z.times ); // then sort them

			times = times.sort( function ( a, b ) {

				return a - b;

			} ); // and remove duplicates

			if ( times.length > 1 ) {

				let targetIndex = 1;
				let lastValue = times[ 0 ];

				for ( let i = 1; i < times.length; i ++ ) {

					const currentValue = times[ i ];

					if ( currentValue !== lastValue ) {

						times[ targetIndex ] = currentValue;
						lastValue = currentValue;
						targetIndex ++;

					}

				}

				times = times.slice( 0, targetIndex );

			}

			return times;

		}

		getKeyframeTrackValues( times, curves, initialValue ) {

			const prevValue = initialValue;
			const values = [];
			let xIndex = - 1;
			let yIndex = - 1;
			let zIndex = - 1;
			times.forEach( function ( time ) {

				if ( curves.x ) xIndex = curves.x.times.indexOf( time );
				if ( curves.y ) yIndex = curves.y.times.indexOf( time );
				if ( curves.z ) zIndex = curves.z.times.indexOf( time ); // if there is an x value defined for this frame, use that

				if ( xIndex !== - 1 ) {

					const xValue = curves.x.values[ xIndex ];
					values.push( xValue );
					prevValue[ 0 ] = xValue;

				} else {

					// otherwise use the x value from the previous frame
					values.push( prevValue[ 0 ] );

				}

				if ( yIndex !== - 1 ) {

					const yValue = curves.y.values[ yIndex ];
					values.push( yValue );
					prevValue[ 1 ] = yValue;

				} else {

					values.push( prevValue[ 1 ] );

				}

				if ( zIndex !== - 1 ) {

					const zValue = curves.z.values[ zIndex ];
					values.push( zValue );
					prevValue[ 2 ] = zValue;

				} else {

					values.push( prevValue[ 2 ] );

				}

			} );
			return values;

		} // Rotations are defined as THREE.Euler angles which can have values  of any size
		// These will be converted to quaternions which don't support values greater than
		// PI, so we'll interpolate large rotations


		interpolateRotations( curve ) {

			for ( let i = 1; i < curve.values.length; i ++ ) {

				const initialValue = curve.values[ i - 1 ];
				const valuesSpan = curve.values[ i ] - initialValue;
				const absoluteSpan = Math.abs( valuesSpan );

				if ( absoluteSpan >= 180 ) {

					const numSubIntervals = absoluteSpan / 180;
					const step = valuesSpan / numSubIntervals;
					let nextValue = initialValue + step;
					const initialTime = curve.times[ i - 1 ];
					const timeSpan = curve.times[ i ] - initialTime;
					const interval = timeSpan / numSubIntervals;
					let nextTime = initialTime + interval;
					const interpolatedTimes = [];
					const interpolatedValues = [];

					while ( nextTime < curve.times[ i ] ) {

						interpolatedTimes.push( nextTime );
						nextTime += interval;
						interpolatedValues.push( nextValue );
						nextValue += step;

					}

					curve.times = inject( curve.times, i, interpolatedTimes );
					curve.values = inject( curve.values, i, interpolatedValues );

				}

			}

		}

	} // parse an FBX file in ASCII format


	class TextParser {

		getPrevNode() {

			return this.nodeStack[ this.currentIndent - 2 ];

		}

		getCurrentNode() {

			return this.nodeStack[ this.currentIndent - 1 ];

		}

		getCurrentProp() {

			return this.currentProp;

		}

		pushStack( node ) {

			this.nodeStack.push( node );
			this.currentIndent += 1;

		}

		popStack() {

			this.nodeStack.pop();
			this.currentIndent -= 1;

		}

		setCurrentProp( val, name ) {

			this.currentProp = val;
			this.currentPropName = name;

		}

		parse( text ) {

			this.currentIndent = 0;
			this.allNodes = new FBXTree();
			this.nodeStack = [];
			this.currentProp = [];
			this.currentPropName = '';
			const scope = this;
			const split = text.split( /[\r\n]+/ );
			split.forEach( function ( line, i ) {

				const matchComment = line.match( /^[\s\t]*;/ );
				const matchEmpty = line.match( /^[\s\t]*$/ );
				if ( matchComment || matchEmpty ) return;
				const matchBeginning = line.match( '^\\t{' + scope.currentIndent + '}(\\w+):(.*){', '' );
				const matchProperty = line.match( '^\\t{' + scope.currentIndent + '}(\\w+):[\\s\\t\\r\\n](.*)' );
				const matchEnd = line.match( '^\\t{' + ( scope.currentIndent - 1 ) + '}}' );

				if ( matchBeginning ) {

					scope.parseNodeBegin( line, matchBeginning );

				} else if ( matchProperty ) {

					scope.parseNodeProperty( line, matchProperty, split[ ++ i ] );

				} else if ( matchEnd ) {

					scope.popStack();

				} else if ( line.match( /^[^\s\t}]/ ) ) {

					// large arrays are split over multiple lines terminated with a ',' character
					// if this is encountered the line needs to be joined to the previous line
					scope.parseNodePropertyContinued( line );

				}

			} );
			return this.allNodes;

		}

		parseNodeBegin( line, property ) {

			const nodeName = property[ 1 ].trim().replace( /^"/, '' ).replace( /"$/, '' );
			const nodeAttrs = property[ 2 ].split( ',' ).map( function ( attr ) {

				return attr.trim().replace( /^"/, '' ).replace( /"$/, '' );

			} );
			const node = {
				name: nodeName
			};
			const attrs = this.parseNodeAttr( nodeAttrs );
			const currentNode = this.getCurrentNode(); // a top node

			if ( this.currentIndent === 0 ) {

				this.allNodes.add( nodeName, node );

			} else {

				// a subnode
				// if the subnode already exists, append it
				if ( nodeName in currentNode ) {

					// special case Pose needs PoseNodes as an array
					if ( nodeName === 'PoseNode' ) {

						currentNode.PoseNode.push( node );

					} else if ( currentNode[ nodeName ].id !== undefined ) {

						currentNode[ nodeName ] = {};
						currentNode[ nodeName ][ currentNode[ nodeName ].id ] = currentNode[ nodeName ];

					}

					if ( attrs.id !== '' ) currentNode[ nodeName ][ attrs.id ] = node;

				} else if ( typeof attrs.id === 'number' ) {

					currentNode[ nodeName ] = {};
					currentNode[ nodeName ][ attrs.id ] = node;

				} else if ( nodeName !== 'Properties70' ) {

					if ( nodeName === 'PoseNode' ) currentNode[ nodeName ] = [ node ]; else currentNode[ nodeName ] = node;

				}

			}

			if ( typeof attrs.id === 'number' ) node.id = attrs.id;
			if ( attrs.name !== '' ) node.attrName = attrs.name;
			if ( attrs.type !== '' ) node.attrType = attrs.type;
			this.pushStack( node );

		}

		parseNodeAttr( attrs ) {

			let id = attrs[ 0 ];

			if ( attrs[ 0 ] !== '' ) {

				id = parseInt( attrs[ 0 ] );

				if ( isNaN( id ) ) {

					id = attrs[ 0 ];

				}

			}

			let name = '',
				type = '';

			if ( attrs.length > 1 ) {

				name = attrs[ 1 ].replace( /^(\w+)::/, '' );
				type = attrs[ 2 ];

			}

			return {
				id: id,
				name: name,
				type: type
			};

		}

		parseNodeProperty( line, property, contentLine ) {

			let propName = property[ 1 ].replace( /^"/, '' ).replace( /"$/, '' ).trim();
			let propValue = property[ 2 ].replace( /^"/, '' ).replace( /"$/, '' ).trim(); // for special case: base64 image data follows "Content: ," line
			//	Content: ,
			//	 "/9j/4RDaRXhpZgAATU0A..."

			if ( propName === 'Content' && propValue === ',' ) {

				propValue = contentLine.replace( /"/g, '' ).replace( /,$/, '' ).trim();

			}

			const currentNode = this.getCurrentNode();
			const parentName = currentNode.name;

			if ( parentName === 'Properties70' ) {

				this.parseNodeSpecialProperty( line, propName, propValue );
				return;

			} // Connections


			if ( propName === 'C' ) {

				const connProps = propValue.split( ',' ).slice( 1 );
				const from = parseInt( connProps[ 0 ] );
				const to = parseInt( connProps[ 1 ] );
				let rest = propValue.split( ',' ).slice( 3 );
				rest = rest.map( function ( elem ) {

					return elem.trim().replace( /^"/, '' );

				} );
				propName = 'connections';
				propValue = [ from, to ];
				append( propValue, rest );

				if ( currentNode[ propName ] === undefined ) {

					currentNode[ propName ] = [];

				}

			} // Node


			if ( propName === 'Node' ) currentNode.id = propValue; // connections

			if ( propName in currentNode && Array.isArray( currentNode[ propName ] ) ) {

				currentNode[ propName ].push( propValue );

			} else {

				if ( propName !== 'a' ) currentNode[ propName ] = propValue; else currentNode.a = propValue;

			}

			this.setCurrentProp( currentNode, propName ); // convert string to array, unless it ends in ',' in which case more will be added to it

			if ( propName === 'a' && propValue.slice( - 1 ) !== ',' ) {

				currentNode.a = parseNumberArray( propValue );

			}

		}

		parseNodePropertyContinued( line ) {

			const currentNode = this.getCurrentNode();
			currentNode.a += line; // if the line doesn't end in ',' we have reached the end of the property value
			// so convert the string to an array

			if ( line.slice( - 1 ) !== ',' ) {

				currentNode.a = parseNumberArray( currentNode.a );

			}

		} // parse "Property70"


		parseNodeSpecialProperty( line, propName, propValue ) {

			// split this
			// P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
			// into array like below
			// ["Lcl Scaling", "Lcl Scaling", "", "A", "1,1,1" ]
			const props = propValue.split( '",' ).map( function ( prop ) {

				return prop.trim().replace( /^\"/, '' ).replace( /\s/, '_' );

			} );
			const innerPropName = props[ 0 ];
			const innerPropType1 = props[ 1 ];
			const innerPropType2 = props[ 2 ];
			const innerPropFlag = props[ 3 ];
			let innerPropValue = props[ 4 ]; // cast values where needed, otherwise leave as strings

			switch ( innerPropType1 ) {

				case 'int':
				case 'enum':
				case 'bool':
				case 'ULongLong':
				case 'double':
				case 'Number':
				case 'FieldOfView':
					innerPropValue = parseFloat( innerPropValue );
					break;

				case 'Color':
				case 'ColorRGB':
				case 'Vector3D':
				case 'Lcl_Translation':
				case 'Lcl_Rotation':
				case 'Lcl_Scaling':
					innerPropValue = parseNumberArray( innerPropValue );
					break;

			} // CAUTION: these props must append to parent's parent


			this.getPrevNode()[ innerPropName ] = {
				'type': innerPropType1,
				'type2': innerPropType2,
				'flag': innerPropFlag,
				'value': innerPropValue
			};
			this.setCurrentProp( this.getPrevNode(), innerPropName );

		}

	} // Parse an FBX file in Binary format


	class BinaryParser {

		parse( buffer ) {

			const reader = new BinaryReader( buffer );
			reader.skip( 23 ); // skip magic 23 bytes

			const version = reader.getUint32();

			if ( version < 6400 ) {

				throw new Error( 'THREE.FBXLoader: FBX version not supported, FileVersion: ' + version );

			}

			const allNodes = new FBXTree();

			while ( ! this.endOfContent( reader ) ) {

				const node = this.parseNode( reader, version );
				if ( node !== null ) allNodes.add( node.name, node );

			}

			return allNodes;

		} // Check if reader has reached the end of content.


		endOfContent( reader ) {

			// footer size: 160bytes + 16-byte alignment padding
			// - 16bytes: magic
			// - padding til 16-byte alignment (at least 1byte?)
			//	(seems like some exporters embed fixed 15 or 16bytes?)
			// - 4bytes: magic
			// - 4bytes: version
			// - 120bytes: zero
			// - 16bytes: magic
			if ( reader.size() % 16 === 0 ) {

				return ( reader.getOffset() + 160 + 16 & ~ 0xf ) >= reader.size();

			} else {

				return reader.getOffset() + 160 + 16 >= reader.size();

			}

		} // recursively parse nodes until the end of the file is reached


		parseNode( reader, version ) {

			const node = {}; // The first three data sizes depends on version.

			const endOffset = version >= 7500 ? reader.getUint64() : reader.getUint32();
			const numProperties = version >= 7500 ? reader.getUint64() : reader.getUint32();
			version >= 7500 ? reader.getUint64() : reader.getUint32(); // the returned propertyListLen is not used

			const nameLen = reader.getUint8();
			const name = reader.getString( nameLen ); // Regards this node as NULL-record if endOffset is zero

			if ( endOffset === 0 ) return null;
			const propertyList = [];

			for ( let i = 0; i < numProperties; i ++ ) {

				propertyList.push( this.parseProperty( reader ) );

			} // Regards the first three elements in propertyList as id, attrName, and attrType


			const id = propertyList.length > 0 ? propertyList[ 0 ] : '';
			const attrName = propertyList.length > 1 ? propertyList[ 1 ] : '';
			const attrType = propertyList.length > 2 ? propertyList[ 2 ] : ''; // check if this node represents just a single property
			// like (name, 0) set or (name2, [0, 1, 2]) set of {name: 0, name2: [0, 1, 2]}

			node.singleProperty = numProperties === 1 && reader.getOffset() === endOffset ? true : false;

			while ( endOffset > reader.getOffset() ) {

				const subNode = this.parseNode( reader, version );
				if ( subNode !== null ) this.parseSubNode( name, node, subNode );

			}

			node.propertyList = propertyList; // raw property list used by parent

			if ( typeof id === 'number' ) node.id = id;
			if ( attrName !== '' ) node.attrName = attrName;
			if ( attrType !== '' ) node.attrType = attrType;
			if ( name !== '' ) node.name = name;
			return node;

		}

		parseSubNode( name, node, subNode ) {

			// special case: child node is single property
			if ( subNode.singleProperty === true ) {

				const value = subNode.propertyList[ 0 ];

				if ( Array.isArray( value ) ) {

					node[ subNode.name ] = subNode;
					subNode.a = value;

				} else {

					node[ subNode.name ] = value;

				}

			} else if ( name === 'Connections' && subNode.name === 'C' ) {

				const array = [];
				subNode.propertyList.forEach( function ( property, i ) {

					// first Connection is FBX type (OO, OP, etc.). We'll discard these
					if ( i !== 0 ) array.push( property );

				} );

				if ( node.connections === undefined ) {

					node.connections = [];

				}

				node.connections.push( array );

			} else if ( subNode.name === 'Properties70' ) {

				const keys = Object.keys( subNode );
				keys.forEach( function ( key ) {

					node[ key ] = subNode[ key ];

				} );

			} else if ( name === 'Properties70' && subNode.name === 'P' ) {

				let innerPropName = subNode.propertyList[ 0 ];
				let innerPropType1 = subNode.propertyList[ 1 ];
				const innerPropType2 = subNode.propertyList[ 2 ];
				const innerPropFlag = subNode.propertyList[ 3 ];
				let innerPropValue;
				if ( innerPropName.indexOf( 'Lcl ' ) === 0 ) innerPropName = innerPropName.replace( 'Lcl ', 'Lcl_' );
				if ( innerPropType1.indexOf( 'Lcl ' ) === 0 ) innerPropType1 = innerPropType1.replace( 'Lcl ', 'Lcl_' );

				if ( innerPropType1 === 'Color' || innerPropType1 === 'ColorRGB' || innerPropType1 === 'Vector' || innerPropType1 === 'Vector3D' || innerPropType1.indexOf( 'Lcl_' ) === 0 ) {

					innerPropValue = [ subNode.propertyList[ 4 ], subNode.propertyList[ 5 ], subNode.propertyList[ 6 ] ];

				} else {

					innerPropValue = subNode.propertyList[ 4 ];

				} // this will be copied to parent, see above


				node[ innerPropName ] = {
					'type': innerPropType1,
					'type2': innerPropType2,
					'flag': innerPropFlag,
					'value': innerPropValue
				};

			} else if ( node[ subNode.name ] === undefined ) {

				if ( typeof subNode.id === 'number' ) {

					node[ subNode.name ] = {};
					node[ subNode.name ][ subNode.id ] = subNode;

				} else {

					node[ subNode.name ] = subNode;

				}

			} else {

				if ( subNode.name === 'PoseNode' ) {

					if ( ! Array.isArray( node[ subNode.name ] ) ) {

						node[ subNode.name ] = [ node[ subNode.name ] ];

					}

					node[ subNode.name ].push( subNode );

				} else if ( node[ subNode.name ][ subNode.id ] === undefined ) {

					node[ subNode.name ][ subNode.id ] = subNode;

				}

			}

		}

		parseProperty( reader ) {

			const type = reader.getString( 1 );
			let length;

			switch ( type ) {

				case 'C':
					return reader.getBoolean();

				case 'D':
					return reader.getFloat64();

				case 'F':
					return reader.getFloat32();

				case 'I':
					return reader.getInt32();

				case 'L':
					return reader.getInt64();

				case 'R':
					length = reader.getUint32();
					return reader.getArrayBuffer( length );

				case 'S':
					length = reader.getUint32();
					return reader.getString( length );

				case 'Y':
					return reader.getInt16();

				case 'b':
				case 'c':
				case 'd':
				case 'f':
				case 'i':
				case 'l':
					const arrayLength = reader.getUint32();
					const encoding = reader.getUint32(); // 0: non-compressed, 1: compressed

					const compressedLength = reader.getUint32();

					if ( encoding === 0 ) {

						switch ( type ) {

							case 'b':
							case 'c':
								return reader.getBooleanArray( arrayLength );

							case 'd':
								return reader.getFloat64Array( arrayLength );

							case 'f':
								return reader.getFloat32Array( arrayLength );

							case 'i':
								return reader.getInt32Array( arrayLength );

							case 'l':
								return reader.getInt64Array( arrayLength );

						}

					}

					if ( typeof fflate === 'undefined' ) {

						console.error( 'THREE.FBXLoader: External library fflate.min.js required.' );

					}

					const data = fflate.unzlibSync( new Uint8Array( reader.getArrayBuffer( compressedLength ) ) ); // eslint-disable-line no-undef

					const reader2 = new BinaryReader( data.buffer );

					switch ( type ) {

						case 'b':
						case 'c':
							return reader2.getBooleanArray( arrayLength );

						case 'd':
							return reader2.getFloat64Array( arrayLength );

						case 'f':
							return reader2.getFloat32Array( arrayLength );

						case 'i':
							return reader2.getInt32Array( arrayLength );

						case 'l':
							return reader2.getInt64Array( arrayLength );

					}

				default:
					throw new Error( 'THREE.FBXLoader: Unknown property type ' + type );

			}

		}

	}

	class BinaryReader {

		constructor( buffer, littleEndian ) {

			this.dv = new DataView( buffer );
			this.offset = 0;
			this.littleEndian = littleEndian !== undefined ? littleEndian : true;

		}

		getOffset() {

			return this.offset;

		}

		size() {

			return this.dv.buffer.byteLength;

		}

		skip( length ) {

			this.offset += length;

		} // seems like true/false representation depends on exporter.
		// true: 1 or 'Y'(=0x59), false: 0 or 'T'(=0x54)
		// then sees LSB.


		getBoolean() {

			return ( this.getUint8() & 1 ) === 1;

		}

		getBooleanArray( size ) {

			const a = [];

			for ( let i = 0; i < size; i ++ ) {

				a.push( this.getBoolean() );

			}

			return a;

		}

		getUint8() {

			const value = this.dv.getUint8( this.offset );
			this.offset += 1;
			return value;

		}

		getInt16() {

			const value = this.dv.getInt16( this.offset, this.littleEndian );
			this.offset += 2;
			return value;

		}

		getInt32() {

			const value = this.dv.getInt32( this.offset, this.littleEndian );
			this.offset += 4;
			return value;

		}

		getInt32Array( size ) {

			const a = [];

			for ( let i = 0; i < size; i ++ ) {

				a.push( this.getInt32() );

			}

			return a;

		}

		getUint32() {

			const value = this.dv.getUint32( this.offset, this.littleEndian );
			this.offset += 4;
			return value;

		} // JavaScript doesn't support 64-bit integer so calculate this here
		// 1 << 32 will return 1 so using multiply operation instead here.
		// There's a possibility that this method returns wrong value if the value
		// is out of the range between Number.MAX_SAFE_INTEGER and Number.MIN_SAFE_INTEGER.
		// TODO: safely handle 64-bit integer


		getInt64() {

			let low, high;

			if ( this.littleEndian ) {

				low = this.getUint32();
				high = this.getUint32();

			} else {

				high = this.getUint32();
				low = this.getUint32();

			} // calculate negative value


			if ( high & 0x80000000 ) {

				high = ~ high & 0xFFFFFFFF;
				low = ~ low & 0xFFFFFFFF;
				if ( low === 0xFFFFFFFF ) high = high + 1 & 0xFFFFFFFF;
				low = low + 1 & 0xFFFFFFFF;
				return - ( high * 0x100000000 + low );

			}

			return high * 0x100000000 + low;

		}

		getInt64Array( size ) {

			const a = [];

			for ( let i = 0; i < size; i ++ ) {

				a.push( this.getInt64() );

			}

			return a;

		} // Note: see getInt64() comment


		getUint64() {

			let low, high;

			if ( this.littleEndian ) {

				low = this.getUint32();
				high = this.getUint32();

			} else {

				high = this.getUint32();
				low = this.getUint32();

			}

			return high * 0x100000000 + low;

		}

		getFloat32() {

			const value = this.dv.getFloat32( this.offset, this.littleEndian );
			this.offset += 4;
			return value;

		}

		getFloat32Array( size ) {

			const a = [];

			for ( let i = 0; i < size; i ++ ) {

				a.push( this.getFloat32() );

			}

			return a;

		}

		getFloat64() {

			const value = this.dv.getFloat64( this.offset, this.littleEndian );
			this.offset += 8;
			return value;

		}

		getFloat64Array( size ) {

			const a = [];

			for ( let i = 0; i < size; i ++ ) {

				a.push( this.getFloat64() );

			}

			return a;

		}

		getArrayBuffer( size ) {

			const value = this.dv.buffer.slice( this.offset, this.offset + size );
			this.offset += size;
			return value;

		}

		getString( size ) {

			// note: safari 9 doesn't support Uint8Array.indexOf; create intermediate array instead
			let a = [];

			for ( let i = 0; i < size; i ++ ) {

				a[ i ] = this.getUint8();

			}

			const nullByte = a.indexOf( 0 );
			if ( nullByte >= 0 ) a = a.slice( 0, nullByte );
			return THREE.LoaderUtils.decodeText( new Uint8Array( a ) );

		}

	} // FBXTree holds a representation of the FBX data, returned by the TextParser ( FBX ASCII format)
	// and BinaryParser( FBX Binary format)


	class FBXTree {

		add( key, val ) {

			this[ key ] = val;

		}

	} // ************** UTILITY FUNCTIONS **************


	function isFbxFormatBinary( buffer ) {

		const CORRECT = 'Kaydara\u0020FBX\u0020Binary\u0020\u0020\0';
		return buffer.byteLength >= CORRECT.length && CORRECT === convertArrayBufferToString( buffer, 0, CORRECT.length );

	}

	function isFbxFormatASCII( text ) {

		const CORRECT = [ 'K', 'a', 'y', 'd', 'a', 'r', 'a', '\\', 'F', 'B', 'X', '\\', 'B', 'i', 'n', 'a', 'r', 'y', '\\', '\\' ];
		let cursor = 0;

		function read( offset ) {

			const result = text[ offset - 1 ];
			text = text.slice( cursor + offset );
			cursor ++;
			return result;

		}

		for ( let i = 0; i < CORRECT.length; ++ i ) {

			const num = read( 1 );

			if ( num === CORRECT[ i ] ) {

				return false;

			}

		}

		return true;

	}

	function getFbxVersion( text ) {

		const versionRegExp = /FBXVersion: (\d+)/;
		const match = text.match( versionRegExp );

		if ( match ) {

			const version = parseInt( match[ 1 ] );
			return version;

		}

		throw new Error( 'THREE.FBXLoader: Cannot find the version number for the file given.' );

	} // Converts FBX ticks into real time seconds.


	function convertFBXTimeToSeconds( time ) {

		return time / 46186158000;

	}

	const dataArray = []; // extracts the data from the correct position in the FBX array based on indexing type

	function getData( polygonVertexIndex, polygonIndex, vertexIndex, infoObject ) {

		let index;

		switch ( infoObject.mappingType ) {

			case 'ByPolygonVertex':
				index = polygonVertexIndex;
				break;

			case 'ByPolygon':
				index = polygonIndex;
				break;

			case 'ByVertice':
				index = vertexIndex;
				break;

			case 'AllSame':
				index = infoObject.indices[ 0 ];
				break;

			default:
				console.warn( 'THREE.FBXLoader: unknown attribute mapping type ' + infoObject.mappingType );

		}

		if ( infoObject.referenceType === 'IndexToDirect' ) index = infoObject.indices[ index ];
		const from = index * infoObject.dataSize;
		const to = from + infoObject.dataSize;
		return slice( dataArray, infoObject.buffer, from, to );

	}

	const tempEuler = new THREE.Euler();
	const tempVec = new THREE.Vector3(); // generate transformation from FBX transform data
	// ref: https://help.autodesk.com/view/FBX/2017/ENU/?guid=__files_GUID_10CDD63C_79C1_4F2D_BB28_AD2BE65A02ED_htm
	// ref: http://docs.autodesk.com/FBX/2014/ENU/FBX-SDK-Documentation/index.html?url=cpp_ref/_transformations_2main_8cxx-example.html,topicNumber=cpp_ref__transformations_2main_8cxx_example_htmlfc10a1e1-b18d-4e72-9dc0-70d0f1959f5e

	function generateTransform( transformData ) {

		const lTranslationM = new THREE.Matrix4();
		const lPreRotationM = new THREE.Matrix4();
		const lRotationM = new THREE.Matrix4();
		const lPostRotationM = new THREE.Matrix4();
		const lScalingM = new THREE.Matrix4();
		const lScalingPivotM = new THREE.Matrix4();
		const lScalingOffsetM = new THREE.Matrix4();
		const lRotationOffsetM = new THREE.Matrix4();
		const lRotationPivotM = new THREE.Matrix4();
		const lParentGX = new THREE.Matrix4();
		const lParentLX = new THREE.Matrix4();
		const lGlobalT = new THREE.Matrix4();
		const inheritType = transformData.inheritType ? transformData.inheritType : 0;
		if ( transformData.translation ) lTranslationM.setPosition( tempVec.fromArray( transformData.translation ) );

		if ( transformData.preRotation ) {

			const array = transformData.preRotation.map( THREE.MathUtils.degToRad );
			array.push( transformData.eulerOrder );
			lPreRotationM.makeRotationFromEuler( tempEuler.fromArray( array ) );

		}

		if ( transformData.rotation ) {

			const array = transformData.rotation.map( THREE.MathUtils.degToRad );
			array.push( transformData.eulerOrder );
			lRotationM.makeRotationFromEuler( tempEuler.fromArray( array ) );

		}

		if ( transformData.postRotation ) {

			const array = transformData.postRotation.map( THREE.MathUtils.degToRad );
			array.push( transformData.eulerOrder );
			lPostRotationM.makeRotationFromEuler( tempEuler.fromArray( array ) );
			lPostRotationM.invert();

		}

		if ( transformData.scale ) lScalingM.scale( tempVec.fromArray( transformData.scale ) ); // Pivots and offsets

		if ( transformData.scalingOffset ) lScalingOffsetM.setPosition( tempVec.fromArray( transformData.scalingOffset ) );
		if ( transformData.scalingPivot ) lScalingPivotM.setPosition( tempVec.fromArray( transformData.scalingPivot ) );
		if ( transformData.rotationOffset ) lRotationOffsetM.setPosition( tempVec.fromArray( transformData.rotationOffset ) );
		if ( transformData.rotationPivot ) lRotationPivotM.setPosition( tempVec.fromArray( transformData.rotationPivot ) ); // parent transform

		if ( transformData.parentMatrixWorld ) {

			lParentLX.copy( transformData.parentMatrix );
			lParentGX.copy( transformData.parentMatrixWorld );

		}

		const lLRM = new THREE.Matrix4().copy( lPreRotationM ).multiply( lRotationM ).multiply( lPostRotationM ); // Global Rotation

		const lParentGRM = new THREE.Matrix4();
		lParentGRM.extractRotation( lParentGX ); // Global Shear*Scaling

		const lParentTM = new THREE.Matrix4();
		lParentTM.copyPosition( lParentGX );
		const lParentGSM = new THREE.Matrix4();
		const lParentGRSM = new THREE.Matrix4().copy( lParentTM ).invert().multiply( lParentGX );
		lParentGSM.copy( lParentGRM ).invert().multiply( lParentGRSM );
		const lLSM = lScalingM;
		const lGlobalRS = new THREE.Matrix4();

		if ( inheritType === 0 ) {

			lGlobalRS.copy( lParentGRM ).multiply( lLRM ).multiply( lParentGSM ).multiply( lLSM );

		} else if ( inheritType === 1 ) {

			lGlobalRS.copy( lParentGRM ).multiply( lParentGSM ).multiply( lLRM ).multiply( lLSM );

		} else {

			const lParentLSM = new THREE.Matrix4().scale( new THREE.Vector3().setFromMatrixScale( lParentLX ) );
			const lParentLSM_inv = new THREE.Matrix4().copy( lParentLSM ).invert();
			const lParentGSM_noLocal = new THREE.Matrix4().copy( lParentGSM ).multiply( lParentLSM_inv );
			lGlobalRS.copy( lParentGRM ).multiply( lLRM ).multiply( lParentGSM_noLocal ).multiply( lLSM );

		}

		const lRotationPivotM_inv = new THREE.Matrix4();
		lRotationPivotM_inv.copy( lRotationPivotM ).invert();
		const lScalingPivotM_inv = new THREE.Matrix4();
		lScalingPivotM_inv.copy( lScalingPivotM ).invert(); // Calculate the local transform matrix

		let lTransform = new THREE.Matrix4();
		lTransform.copy( lTranslationM ).multiply( lRotationOffsetM ).multiply( lRotationPivotM ).multiply( lPreRotationM ).multiply( lRotationM ).multiply( lPostRotationM ).multiply( lRotationPivotM_inv ).multiply( lScalingOffsetM ).multiply( lScalingPivotM ).multiply( lScalingM ).multiply( lScalingPivotM_inv );
		const lLocalTWithAllPivotAndOffsetInfo = new THREE.Matrix4().copyPosition( lTransform );
		const lGlobalTranslation = new THREE.Matrix4().copy( lParentGX ).multiply( lLocalTWithAllPivotAndOffsetInfo );
		lGlobalT.copyPosition( lGlobalTranslation );
		lTransform = new THREE.Matrix4().copy( lGlobalT ).multiply( lGlobalRS ); // from global to local

		lTransform.premultiply( lParentGX.invert() );
		return lTransform;

	} // Returns the three.js intrinsic THREE.Euler order corresponding to FBX extrinsic THREE.Euler order
	// ref: http://help.autodesk.com/view/FBX/2017/ENU/?guid=__cpp_ref_class_fbx_euler_html


	function getEulerOrder( order ) {

		order = order || 0;
		const enums = [ 'ZYX', // -> XYZ extrinsic
			'YZX', // -> XZY extrinsic
			'XZY', // -> YZX extrinsic
			'ZXY', // -> YXZ extrinsic
			'YXZ', // -> ZXY extrinsic
			'XYZ' // -> ZYX extrinsic
			//'SphericXYZ', // not possible to support
		];

		if ( order === 6 ) {

			console.warn( 'THREE.FBXLoader: unsupported THREE.Euler Order: Spherical XYZ. Animations and rotations may be incorrect.' );
			return enums[ 0 ];

		}

		return enums[ order ];

	} // Parses comma separated list of numbers and returns them an array.
	// Used internally by the TextParser


	function parseNumberArray( value ) {

		const array = value.split( ',' ).map( function ( val ) {

			return parseFloat( val );

		} );
		return array;

	}

	function convertArrayBufferToString( buffer, from, to ) {

		if ( from === undefined ) from = 0;
		if ( to === undefined ) to = buffer.byteLength;
		return THREE.LoaderUtils.decodeText( new Uint8Array( buffer, from, to ) );

	}

	function append( a, b ) {

		for ( let i = 0, j = a.length, l = b.length; i < l; i ++, j ++ ) {

			a[ j ] = b[ i ];

		}

	}

	function slice( a, b, from, to ) {

		for ( let i = from, j = 0; i < to; i ++, j ++ ) {

			a[ j ] = b[ i ];

		}

		return a;

	} // inject array a2 into array a1 at index


	function inject( a1, index, a2 ) {

		return a1.slice( 0, index ).concat( a2 ).concat( a1.slice( index ) );

	}

	THREE.FBXLoader = FBXLoader;

} )();

( function () {

	class GLTFLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );
			this.dracoLoader = null;
			this.ktx2Loader = null;
			this.meshoptDecoder = null;
			this.pluginCallbacks = [];
			this.register( function ( parser ) {

				return new GLTFMaterialsClearcoatExtension( parser );

			} );
			this.register( function ( parser ) {

				return new GLTFTextureBasisUExtension( parser );

			} );
			this.register( function ( parser ) {

				return new GLTFTextureWebPExtension( parser );

			} );
			this.register( function ( parser ) {

				return new GLTFMaterialsTransmissionExtension( parser );

			} );
			this.register( function ( parser ) {

				return new GLTFLightsExtension( parser );

			} );
			this.register( function ( parser ) {

				return new GLTFMeshoptCompression( parser );

			} );

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			let resourcePath;

			if ( this.resourcePath !== '' ) {

				resourcePath = this.resourcePath;

			} else if ( this.path !== '' ) {

				resourcePath = this.path;

			} else {

				resourcePath = THREE.LoaderUtils.extractUrlBase( url );

			} // Tells the LoadingManager to track an extra item, which resolves after
			// the model is fully loaded. This means the count of items loaded will
			// be incorrect, but ensures manager.onLoad() does not fire early.


			this.manager.itemStart( url );

			const _onError = function ( e ) {

				if ( onError ) {

					onError( e );

				} else {

					console.error( e );

				}

				scope.manager.itemError( url );
				scope.manager.itemEnd( url );

			};

			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( data ) {

				try {

					scope.parse( data, resourcePath, function ( gltf ) {

						onLoad( gltf );
						scope.manager.itemEnd( url );

					}, _onError );

				} catch ( e ) {

					_onError( e );

				}

			}, onProgress, _onError );

		}

		setDRACOLoader( dracoLoader ) {

			this.dracoLoader = dracoLoader;
			return this;

		}

		setDDSLoader() {

			throw new Error( 'THREE.GLTFLoader: "MSFT_texture_dds" no longer supported. Please update to "KHR_texture_basisu".' );

		}

		setKTX2Loader( ktx2Loader ) {

			this.ktx2Loader = ktx2Loader;
			return this;

		}

		setMeshoptDecoder( meshoptDecoder ) {

			this.meshoptDecoder = meshoptDecoder;
			return this;

		}

		register( callback ) {

			if ( this.pluginCallbacks.indexOf( callback ) === - 1 ) {

				this.pluginCallbacks.push( callback );

			}

			return this;

		}

		unregister( callback ) {

			if ( this.pluginCallbacks.indexOf( callback ) !== - 1 ) {

				this.pluginCallbacks.splice( this.pluginCallbacks.indexOf( callback ), 1 );

			}

			return this;

		}

		parse( data, path, onLoad, onError ) {

			let content;
			const extensions = {};
			const plugins = {};

			if ( typeof data === 'string' ) {

				content = data;

			} else {

				const magic = THREE.LoaderUtils.decodeText( new Uint8Array( data, 0, 4 ) );

				if ( magic === BINARY_EXTENSION_HEADER_MAGIC ) {

					try {

						extensions[ EXTENSIONS.KHR_BINARY_GLTF ] = new GLTFBinaryExtension( data );

					} catch ( error ) {

						if ( onError ) onError( error );
						return;

					}

					content = extensions[ EXTENSIONS.KHR_BINARY_GLTF ].content;

				} else {

					content = THREE.LoaderUtils.decodeText( new Uint8Array( data ) );

				}

			}

			const json = JSON.parse( content );

			if ( json.asset === undefined || json.asset.version[ 0 ] < 2 ) {

				if ( onError ) onError( new Error( 'THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported.' ) );
				return;

			}

			const parser = new GLTFParser( json, {
				path: path || this.resourcePath || '',
				crossOrigin: this.crossOrigin,
				requestHeader: this.requestHeader,
				manager: this.manager,
				ktx2Loader: this.ktx2Loader,
				meshoptDecoder: this.meshoptDecoder
			} );
			parser.fileLoader.setRequestHeader( this.requestHeader );

			for ( let i = 0; i < this.pluginCallbacks.length; i ++ ) {

				const plugin = this.pluginCallbacks[ i ]( parser );
				plugins[ plugin.name ] = plugin; // Workaround to avoid determining as unknown extension
				// in addUnknownExtensionsToUserData().
				// Remove this workaround if we move all the existing
				// extension handlers to plugin system

				extensions[ plugin.name ] = true;

			}

			if ( json.extensionsUsed ) {

				for ( let i = 0; i < json.extensionsUsed.length; ++ i ) {

					const extensionName = json.extensionsUsed[ i ];
					const extensionsRequired = json.extensionsRequired || [];

					switch ( extensionName ) {

						case EXTENSIONS.KHR_MATERIALS_UNLIT:
							extensions[ extensionName ] = new GLTFMaterialsUnlitExtension();
							break;

						case EXTENSIONS.KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS:
							extensions[ extensionName ] = new GLTFMaterialsPbrSpecularGlossinessExtension();
							break;

						case EXTENSIONS.KHR_DRACO_MESH_COMPRESSION:
							extensions[ extensionName ] = new GLTFDracoMeshCompressionExtension( json, this.dracoLoader );
							break;

						case EXTENSIONS.KHR_TEXTURE_TRANSFORM:
							extensions[ extensionName ] = new GLTFTextureTransformExtension();
							break;

						case EXTENSIONS.KHR_MESH_QUANTIZATION:
							extensions[ extensionName ] = new GLTFMeshQuantizationExtension();
							break;

						default:
							if ( extensionsRequired.indexOf( extensionName ) >= 0 && plugins[ extensionName ] === undefined ) {

								console.warn( 'THREE.GLTFLoader: Unknown extension "' + extensionName + '".' );

							}

					}

				}

			}

			parser.setExtensions( extensions );
			parser.setPlugins( plugins );
			parser.parse( onLoad, onError );

		}

	}
	/* GLTFREGISTRY */


	function GLTFRegistry() {

		let objects = {};
		return {
			get: function ( key ) {

				return objects[ key ];

			},
			add: function ( key, object ) {

				objects[ key ] = object;

			},
			remove: function ( key ) {

				delete objects[ key ];

			},
			removeAll: function () {

				objects = {};

			}
		};

	}
	/*********************************/

	/********** EXTENSIONS ***********/

	/*********************************/


	const EXTENSIONS = {
		KHR_BINARY_GLTF: 'KHR_binary_glTF',
		KHR_DRACO_MESH_COMPRESSION: 'KHR_draco_mesh_compression',
		KHR_LIGHTS_PUNCTUAL: 'KHR_lights_punctual',
		KHR_MATERIALS_CLEARCOAT: 'KHR_materials_clearcoat',
		KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS: 'KHR_materials_pbrSpecularGlossiness',
		KHR_MATERIALS_TRANSMISSION: 'KHR_materials_transmission',
		KHR_MATERIALS_UNLIT: 'KHR_materials_unlit',
		KHR_TEXTURE_BASISU: 'KHR_texture_basisu',
		KHR_TEXTURE_TRANSFORM: 'KHR_texture_transform',
		KHR_MESH_QUANTIZATION: 'KHR_mesh_quantization',
		EXT_TEXTURE_WEBP: 'EXT_texture_webp',
		EXT_MESHOPT_COMPRESSION: 'EXT_meshopt_compression'
	};
	/**
 * Punctual Lights Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_lights_punctual
 */

	class GLTFLightsExtension {

		constructor( parser ) {

			this.parser = parser;
			this.name = EXTENSIONS.KHR_LIGHTS_PUNCTUAL; // THREE.Object3D instance caches

			this.cache = {
				refs: {},
				uses: {}
			};

		}

		_markDefs() {

			const parser = this.parser;
			const nodeDefs = this.parser.json.nodes || [];

			for ( let nodeIndex = 0, nodeLength = nodeDefs.length; nodeIndex < nodeLength; nodeIndex ++ ) {

				const nodeDef = nodeDefs[ nodeIndex ];

				if ( nodeDef.extensions && nodeDef.extensions[ this.name ] && nodeDef.extensions[ this.name ].light !== undefined ) {

					parser._addNodeRef( this.cache, nodeDef.extensions[ this.name ].light );

				}

			}

		}

		_loadLight( lightIndex ) {

			const parser = this.parser;
			const cacheKey = 'light:' + lightIndex;
			let dependency = parser.cache.get( cacheKey );
			if ( dependency ) return dependency;
			const json = parser.json;
			const extensions = json.extensions && json.extensions[ this.name ] || {};
			const lightDefs = extensions.lights || [];
			const lightDef = lightDefs[ lightIndex ];
			let lightNode;
			const color = new THREE.Color( 0xffffff );
			if ( lightDef.color !== undefined ) color.fromArray( lightDef.color );
			const range = lightDef.range !== undefined ? lightDef.range : 0;

			switch ( lightDef.type ) {

				case 'directional':
					lightNode = new THREE.DirectionalLight( color );
					lightNode.target.position.set( 0, 0, - 1 );
					lightNode.add( lightNode.target );
					break;

				case 'point':
					lightNode = new THREE.PointLight( color );
					lightNode.distance = range;
					break;

				case 'spot':
					lightNode = new THREE.SpotLight( color );
					lightNode.distance = range; // Handle spotlight properties.

					lightDef.spot = lightDef.spot || {};
					lightDef.spot.innerConeAngle = lightDef.spot.innerConeAngle !== undefined ? lightDef.spot.innerConeAngle : 0;
					lightDef.spot.outerConeAngle = lightDef.spot.outerConeAngle !== undefined ? lightDef.spot.outerConeAngle : Math.PI / 4.0;
					lightNode.angle = lightDef.spot.outerConeAngle;
					lightNode.penumbra = 1.0 - lightDef.spot.innerConeAngle / lightDef.spot.outerConeAngle;
					lightNode.target.position.set( 0, 0, - 1 );
					lightNode.add( lightNode.target );
					break;

				default:
					throw new Error( 'THREE.GLTFLoader: Unexpected light type: ' + lightDef.type );

			} // Some lights (e.g. spot) default to a position other than the origin. Reset the position
			// here, because node-level parsing will only override position if explicitly specified.


			lightNode.position.set( 0, 0, 0 );
			lightNode.decay = 2;
			if ( lightDef.intensity !== undefined ) lightNode.intensity = lightDef.intensity;
			lightNode.name = parser.createUniqueName( lightDef.name || 'light_' + lightIndex );
			dependency = Promise.resolve( lightNode );
			parser.cache.add( cacheKey, dependency );
			return dependency;

		}

		createNodeAttachment( nodeIndex ) {

			const self = this;
			const parser = this.parser;
			const json = parser.json;
			const nodeDef = json.nodes[ nodeIndex ];
			const lightDef = nodeDef.extensions && nodeDef.extensions[ this.name ] || {};
			const lightIndex = lightDef.light;
			if ( lightIndex === undefined ) return null;
			return this._loadLight( lightIndex ).then( function ( light ) {

				return parser._getNodeRef( self.cache, lightIndex, light );

			} );

		}

	}
	/**
 * Unlit Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_unlit
 */


	class GLTFMaterialsUnlitExtension {

		constructor() {

			this.name = EXTENSIONS.KHR_MATERIALS_UNLIT;

		}

		getMaterialType() {

			return THREE.MeshBasicMaterial;

		}

		extendParams( materialParams, materialDef, parser ) {

			const pending = [];
			materialParams.color = new THREE.Color( 1.0, 1.0, 1.0 );
			materialParams.opacity = 1.0;
			const metallicRoughness = materialDef.pbrMetallicRoughness;

			if ( metallicRoughness ) {

				if ( Array.isArray( metallicRoughness.baseColorFactor ) ) {

					const array = metallicRoughness.baseColorFactor;
					materialParams.color.fromArray( array );
					materialParams.opacity = array[ 3 ];

				}

				if ( metallicRoughness.baseColorTexture !== undefined ) {

					pending.push( parser.assignTexture( materialParams, 'map', metallicRoughness.baseColorTexture ) );

				}

			}

			return Promise.all( pending );

		}

	}
	/**
 * Clearcoat Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_clearcoat
 */


	class GLTFMaterialsClearcoatExtension {

		constructor( parser ) {

			this.parser = parser;
			this.name = EXTENSIONS.KHR_MATERIALS_CLEARCOAT;

		}

		getMaterialType( materialIndex ) {

			const parser = this.parser;
			const materialDef = parser.json.materials[ materialIndex ];
			if ( ! materialDef.extensions || ! materialDef.extensions[ this.name ] ) return null;
			return THREE.MeshPhysicalMaterial;

		}

		extendMaterialParams( materialIndex, materialParams ) {

			const parser = this.parser;
			const materialDef = parser.json.materials[ materialIndex ];

			if ( ! materialDef.extensions || ! materialDef.extensions[ this.name ] ) {

				return Promise.resolve();

			}

			const pending = [];
			const extension = materialDef.extensions[ this.name ];

			if ( extension.clearcoatFactor !== undefined ) {

				materialParams.clearcoat = extension.clearcoatFactor;

			}

			if ( extension.clearcoatTexture !== undefined ) {

				pending.push( parser.assignTexture( materialParams, 'clearcoatMap', extension.clearcoatTexture ) );

			}

			if ( extension.clearcoatRoughnessFactor !== undefined ) {

				materialParams.clearcoatRoughness = extension.clearcoatRoughnessFactor;

			}

			if ( extension.clearcoatRoughnessTexture !== undefined ) {

				pending.push( parser.assignTexture( materialParams, 'clearcoatRoughnessMap', extension.clearcoatRoughnessTexture ) );

			}

			if ( extension.clearcoatNormalTexture !== undefined ) {

				pending.push( parser.assignTexture( materialParams, 'clearcoatNormalMap', extension.clearcoatNormalTexture ) );

				if ( extension.clearcoatNormalTexture.scale !== undefined ) {

					const scale = extension.clearcoatNormalTexture.scale; // https://github.com/mrdoob/three.js/issues/11438#issuecomment-507003995

					materialParams.clearcoatNormalScale = new THREE.Vector2( scale, - scale );

				}

			}

			return Promise.all( pending );

		}

	}
	/**
 * Transmission Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_transmission
 * Draft: https://github.com/KhronosGroup/glTF/pull/1698
 */


	class GLTFMaterialsTransmissionExtension {

		constructor( parser ) {

			this.parser = parser;
			this.name = EXTENSIONS.KHR_MATERIALS_TRANSMISSION;

		}

		getMaterialType( materialIndex ) {

			const parser = this.parser;
			const materialDef = parser.json.materials[ materialIndex ];
			if ( ! materialDef.extensions || ! materialDef.extensions[ this.name ] ) return null;
			return THREE.MeshPhysicalMaterial;

		}

		extendMaterialParams( materialIndex, materialParams ) {

			const parser = this.parser;
			const materialDef = parser.json.materials[ materialIndex ];

			if ( ! materialDef.extensions || ! materialDef.extensions[ this.name ] ) {

				return Promise.resolve();

			}

			const pending = [];
			const extension = materialDef.extensions[ this.name ];

			if ( extension.transmissionFactor !== undefined ) {

				materialParams.transmission = extension.transmissionFactor;

			}

			if ( extension.transmissionTexture !== undefined ) {

				pending.push( parser.assignTexture( materialParams, 'transmissionMap', extension.transmissionTexture ) );

			}

			return Promise.all( pending );

		}

	}
	/**
 * BasisU Texture Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_texture_basisu
 */


	class GLTFTextureBasisUExtension {

		constructor( parser ) {

			this.parser = parser;
			this.name = EXTENSIONS.KHR_TEXTURE_BASISU;

		}

		loadTexture( textureIndex ) {

			const parser = this.parser;
			const json = parser.json;
			const textureDef = json.textures[ textureIndex ];

			if ( ! textureDef.extensions || ! textureDef.extensions[ this.name ] ) {

				return null;

			}

			const extension = textureDef.extensions[ this.name ];
			const source = json.images[ extension.source ];
			const loader = parser.options.ktx2Loader;

			if ( ! loader ) {

				if ( json.extensionsRequired && json.extensionsRequired.indexOf( this.name ) >= 0 ) {

					throw new Error( 'THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures' );

				} else {

					// Assumes that the extension is optional and that a fallback texture is present
					return null;

				}

			}

			return parser.loadTextureImage( textureIndex, source, loader );

		}

	}
	/**
 * WebP Texture Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Vendor/EXT_texture_webp
 */


	class GLTFTextureWebPExtension {

		constructor( parser ) {

			this.parser = parser;
			this.name = EXTENSIONS.EXT_TEXTURE_WEBP;
			this.isSupported = null;

		}

		loadTexture( textureIndex ) {

			const name = this.name;
			const parser = this.parser;
			const json = parser.json;
			const textureDef = json.textures[ textureIndex ];

			if ( ! textureDef.extensions || ! textureDef.extensions[ name ] ) {

				return null;

			}

			const extension = textureDef.extensions[ name ];
			const source = json.images[ extension.source ];
			let loader = parser.textureLoader;

			if ( source.uri ) {

				const handler = parser.options.manager.getHandler( source.uri );
				if ( handler !== null ) loader = handler;

			}

			return this.detectSupport().then( function ( isSupported ) {

				if ( isSupported ) return parser.loadTextureImage( textureIndex, source, loader );

				if ( json.extensionsRequired && json.extensionsRequired.indexOf( name ) >= 0 ) {

					throw new Error( 'THREE.GLTFLoader: WebP required by asset but unsupported.' );

				} // Fall back to PNG or JPEG.


				return parser.loadTexture( textureIndex );

			} );

		}

		detectSupport() {

			if ( ! this.isSupported ) {

				this.isSupported = new Promise( function ( resolve ) {

					const image = new Image(); // Lossy test image. Support for lossy images doesn't guarantee support for all
					// WebP images, unfortunately.

					image.src = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';

					image.onload = image.onerror = function () {

						resolve( image.height === 1 );

					};

				} );

			}

			return this.isSupported;

		}

	}
	/**
 * meshopt BufferView Compression Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Vendor/EXT_meshopt_compression
 */


	class GLTFMeshoptCompression {

		constructor( parser ) {

			this.name = EXTENSIONS.EXT_MESHOPT_COMPRESSION;
			this.parser = parser;

		}

		loadBufferView( index ) {

			const json = this.parser.json;
			const bufferView = json.bufferViews[ index ];

			if ( bufferView.extensions && bufferView.extensions[ this.name ] ) {

				const extensionDef = bufferView.extensions[ this.name ];
				const buffer = this.parser.getDependency( 'buffer', extensionDef.buffer );
				const decoder = this.parser.options.meshoptDecoder;

				if ( ! decoder || ! decoder.supported ) {

					if ( json.extensionsRequired && json.extensionsRequired.indexOf( this.name ) >= 0 ) {

						throw new Error( 'THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files' );

					} else {

						// Assumes that the extension is optional and that fallback buffer data is present
						return null;

					}

				}

				return Promise.all( [ buffer, decoder.ready ] ).then( function ( res ) {

					const byteOffset = extensionDef.byteOffset || 0;
					const byteLength = extensionDef.byteLength || 0;
					const count = extensionDef.count;
					const stride = extensionDef.byteStride;
					const result = new ArrayBuffer( count * stride );
					const source = new Uint8Array( res[ 0 ], byteOffset, byteLength );
					decoder.decodeGltfBuffer( new Uint8Array( result ), count, stride, source, extensionDef.mode, extensionDef.filter );
					return result;

				} );

			} else {

				return null;

			}

		}

	}
	/* BINARY EXTENSION */


	const BINARY_EXTENSION_HEADER_MAGIC = 'glTF';
	const BINARY_EXTENSION_HEADER_LENGTH = 12;
	const BINARY_EXTENSION_CHUNK_TYPES = {
		JSON: 0x4E4F534A,
		BIN: 0x004E4942
	};

	class GLTFBinaryExtension {

		constructor( data ) {

			this.name = EXTENSIONS.KHR_BINARY_GLTF;
			this.content = null;
			this.body = null;
			const headerView = new DataView( data, 0, BINARY_EXTENSION_HEADER_LENGTH );
			this.header = {
				magic: THREE.LoaderUtils.decodeText( new Uint8Array( data.slice( 0, 4 ) ) ),
				version: headerView.getUint32( 4, true ),
				length: headerView.getUint32( 8, true )
			};

			if ( this.header.magic !== BINARY_EXTENSION_HEADER_MAGIC ) {

				throw new Error( 'THREE.GLTFLoader: Unsupported glTF-Binary header.' );

			} else if ( this.header.version < 2.0 ) {

				throw new Error( 'THREE.GLTFLoader: Legacy binary file detected.' );

			}

			const chunkContentsLength = this.header.length - BINARY_EXTENSION_HEADER_LENGTH;
			const chunkView = new DataView( data, BINARY_EXTENSION_HEADER_LENGTH );
			let chunkIndex = 0;

			while ( chunkIndex < chunkContentsLength ) {

				const chunkLength = chunkView.getUint32( chunkIndex, true );
				chunkIndex += 4;
				const chunkType = chunkView.getUint32( chunkIndex, true );
				chunkIndex += 4;

				if ( chunkType === BINARY_EXTENSION_CHUNK_TYPES.JSON ) {

					const contentArray = new Uint8Array( data, BINARY_EXTENSION_HEADER_LENGTH + chunkIndex, chunkLength );
					this.content = THREE.LoaderUtils.decodeText( contentArray );

				} else if ( chunkType === BINARY_EXTENSION_CHUNK_TYPES.BIN ) {

					const byteOffset = BINARY_EXTENSION_HEADER_LENGTH + chunkIndex;
					this.body = data.slice( byteOffset, byteOffset + chunkLength );

				} // Clients must ignore chunks with unknown types.


				chunkIndex += chunkLength;

			}

			if ( this.content === null ) {

				throw new Error( 'THREE.GLTFLoader: JSON content not found.' );

			}

		}

	}
	/**
 * DRACO THREE.Mesh Compression Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_draco_mesh_compression
 */


	class GLTFDracoMeshCompressionExtension {

		constructor( json, dracoLoader ) {

			if ( ! dracoLoader ) {

				throw new Error( 'THREE.GLTFLoader: No DRACOLoader instance provided.' );

			}

			this.name = EXTENSIONS.KHR_DRACO_MESH_COMPRESSION;
			this.json = json;
			this.dracoLoader = dracoLoader;
			this.dracoLoader.preload();

		}

		decodePrimitive( primitive, parser ) {

			const json = this.json;
			const dracoLoader = this.dracoLoader;
			const bufferViewIndex = primitive.extensions[ this.name ].bufferView;
			const gltfAttributeMap = primitive.extensions[ this.name ].attributes;
			const threeAttributeMap = {};
			const attributeNormalizedMap = {};
			const attributeTypeMap = {};

			for ( const attributeName in gltfAttributeMap ) {

				const threeAttributeName = ATTRIBUTES[ attributeName ] || attributeName.toLowerCase();
				threeAttributeMap[ threeAttributeName ] = gltfAttributeMap[ attributeName ];

			}

			for ( const attributeName in primitive.attributes ) {

				const threeAttributeName = ATTRIBUTES[ attributeName ] || attributeName.toLowerCase();

				if ( gltfAttributeMap[ attributeName ] !== undefined ) {

					const accessorDef = json.accessors[ primitive.attributes[ attributeName ] ];
					const componentType = WEBGL_COMPONENT_TYPES[ accessorDef.componentType ];
					attributeTypeMap[ threeAttributeName ] = componentType;
					attributeNormalizedMap[ threeAttributeName ] = accessorDef.normalized === true;

				}

			}

			return parser.getDependency( 'bufferView', bufferViewIndex ).then( function ( bufferView ) {

				return new Promise( function ( resolve ) {

					dracoLoader.decodeDracoFile( bufferView, function ( geometry ) {

						for ( const attributeName in geometry.attributes ) {

							const attribute = geometry.attributes[ attributeName ];
							const normalized = attributeNormalizedMap[ attributeName ];
							if ( normalized !== undefined ) attribute.normalized = normalized;

						}

						resolve( geometry );

					}, threeAttributeMap, attributeTypeMap );

				} );

			} );

		}

	}
	/**
 * Texture Transform Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_texture_transform
 */


	class GLTFTextureTransformExtension {

		constructor() {

			this.name = EXTENSIONS.KHR_TEXTURE_TRANSFORM;

		}

		extendTexture( texture, transform ) {

			if ( transform.texCoord !== undefined ) {

				console.warn( 'THREE.GLTFLoader: Custom UV sets in "' + this.name + '" extension not yet supported.' );

			}

			if ( transform.offset === undefined && transform.rotation === undefined && transform.scale === undefined ) {

				// See https://github.com/mrdoob/three.js/issues/21819.
				return texture;

			}

			texture = texture.clone();

			if ( transform.offset !== undefined ) {

				texture.offset.fromArray( transform.offset );

			}

			if ( transform.rotation !== undefined ) {

				texture.rotation = transform.rotation;

			}

			if ( transform.scale !== undefined ) {

				texture.repeat.fromArray( transform.scale );

			}

			texture.needsUpdate = true;
			return texture;

		}

	}
	/**
 * Specular-Glossiness Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_pbrSpecularGlossiness
 */

	/**
 * A sub class of StandardMaterial with some of the functionality
 * changed via the `onBeforeCompile` callback
 * @pailhead
 */


	class GLTFMeshStandardSGMaterial extends THREE.MeshStandardMaterial {

		constructor( params ) {

			super();
			this.isGLTFSpecularGlossinessMaterial = true; //various chunks that need replacing

			const specularMapParsFragmentChunk = [ '#ifdef USE_SPECULARMAP', '	uniform sampler2D specularMap;', '#endif' ].join( '\n' );
			const glossinessMapParsFragmentChunk = [ '#ifdef USE_GLOSSINESSMAP', '	uniform sampler2D glossinessMap;', '#endif' ].join( '\n' );
			const specularMapFragmentChunk = [ 'vec3 specularFactor = specular;', '#ifdef USE_SPECULARMAP', '	vec4 texelSpecular = texture2D( specularMap, vUv );', '	texelSpecular = sRGBToLinear( texelSpecular );', '	// reads channel RGB, compatible with a glTF Specular-Glossiness (RGBA) texture', '	specularFactor *= texelSpecular.rgb;', '#endif' ].join( '\n' );
			const glossinessMapFragmentChunk = [ 'float glossinessFactor = glossiness;', '#ifdef USE_GLOSSINESSMAP', '	vec4 texelGlossiness = texture2D( glossinessMap, vUv );', '	// reads channel A, compatible with a glTF Specular-Glossiness (RGBA) texture', '	glossinessFactor *= texelGlossiness.a;', '#endif' ].join( '\n' );
			const lightPhysicalFragmentChunk = [ 'PhysicalMaterial material;', 'material.diffuseColor = diffuseColor.rgb * ( 1. - max( specularFactor.r, max( specularFactor.g, specularFactor.b ) ) );', 'vec3 dxy = max( abs( dFdx( geometryNormal ) ), abs( dFdy( geometryNormal ) ) );', 'float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );', 'material.specularRoughness = max( 1.0 - glossinessFactor, 0.0525 ); // 0.0525 corresponds to the base mip of a 256 cubemap.', 'material.specularRoughness += geometryRoughness;', 'material.specularRoughness = min( material.specularRoughness, 1.0 );', 'material.specularColor = specularFactor;' ].join( '\n' );
			const uniforms = {
				specular: {
					value: new THREE.Color().setHex( 0xffffff )
				},
				glossiness: {
					value: 1
				},
				specularMap: {
					value: null
				},
				glossinessMap: {
					value: null
				}
			};
			this._extraUniforms = uniforms;

			this.onBeforeCompile = function ( shader ) {

				for ( const uniformName in uniforms ) {

					shader.uniforms[ uniformName ] = uniforms[ uniformName ];

				}

				shader.fragmentShader = shader.fragmentShader.replace( 'uniform float roughness;', 'uniform vec3 specular;' ).replace( 'uniform float metalness;', 'uniform float glossiness;' ).replace( '#include <roughnessmap_pars_fragment>', specularMapParsFragmentChunk ).replace( '#include <metalnessmap_pars_fragment>', glossinessMapParsFragmentChunk ).replace( '#include <roughnessmap_fragment>', specularMapFragmentChunk ).replace( '#include <metalnessmap_fragment>', glossinessMapFragmentChunk ).replace( '#include <lights_physical_fragment>', lightPhysicalFragmentChunk );

			};

			Object.defineProperties( this, {
				specular: {
					get: function () {

						return uniforms.specular.value;

					},
					set: function ( v ) {

						uniforms.specular.value = v;

					}
				},
				specularMap: {
					get: function () {

						return uniforms.specularMap.value;

					},
					set: function ( v ) {

						uniforms.specularMap.value = v;

						if ( v ) {

							this.defines.USE_SPECULARMAP = ''; // USE_UV is set by the renderer for specular maps

						} else {

							delete this.defines.USE_SPECULARMAP;

						}

					}
				},
				glossiness: {
					get: function () {

						return uniforms.glossiness.value;

					},
					set: function ( v ) {

						uniforms.glossiness.value = v;

					}
				},
				glossinessMap: {
					get: function () {

						return uniforms.glossinessMap.value;

					},
					set: function ( v ) {

						uniforms.glossinessMap.value = v;

						if ( v ) {

							this.defines.USE_GLOSSINESSMAP = '';
							this.defines.USE_UV = '';

						} else {

							delete this.defines.USE_GLOSSINESSMAP;
							delete this.defines.USE_UV;

						}

					}
				}
			} );
			delete this.metalness;
			delete this.roughness;
			delete this.metalnessMap;
			delete this.roughnessMap;
			this.setValues( params );

		}

		copy( source ) {

			super.copy( source );
			this.specularMap = source.specularMap;
			this.specular.copy( source.specular );
			this.glossinessMap = source.glossinessMap;
			this.glossiness = source.glossiness;
			delete this.metalness;
			delete this.roughness;
			delete this.metalnessMap;
			delete this.roughnessMap;
			return this;

		}

	}

	class GLTFMaterialsPbrSpecularGlossinessExtension {

		constructor() {

			this.name = EXTENSIONS.KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS;
			this.specularGlossinessParams = [ 'color', 'map', 'lightMap', 'lightMapIntensity', 'aoMap', 'aoMapIntensity', 'emissive', 'emissiveIntensity', 'emissiveMap', 'bumpMap', 'bumpScale', 'normalMap', 'normalMapType', 'displacementMap', 'displacementScale', 'displacementBias', 'specularMap', 'specular', 'glossinessMap', 'glossiness', 'alphaMap', 'envMap', 'envMapIntensity', 'refractionRatio' ];

		}

		getMaterialType() {

			return GLTFMeshStandardSGMaterial;

		}

		extendParams( materialParams, materialDef, parser ) {

			const pbrSpecularGlossiness = materialDef.extensions[ this.name ];
			materialParams.color = new THREE.Color( 1.0, 1.0, 1.0 );
			materialParams.opacity = 1.0;
			const pending = [];

			if ( Array.isArray( pbrSpecularGlossiness.diffuseFactor ) ) {

				const array = pbrSpecularGlossiness.diffuseFactor;
				materialParams.color.fromArray( array );
				materialParams.opacity = array[ 3 ];

			}

			if ( pbrSpecularGlossiness.diffuseTexture !== undefined ) {

				pending.push( parser.assignTexture( materialParams, 'map', pbrSpecularGlossiness.diffuseTexture ) );

			}

			materialParams.emissive = new THREE.Color( 0.0, 0.0, 0.0 );
			materialParams.glossiness = pbrSpecularGlossiness.glossinessFactor !== undefined ? pbrSpecularGlossiness.glossinessFactor : 1.0;
			materialParams.specular = new THREE.Color( 1.0, 1.0, 1.0 );

			if ( Array.isArray( pbrSpecularGlossiness.specularFactor ) ) {

				materialParams.specular.fromArray( pbrSpecularGlossiness.specularFactor );

			}

			if ( pbrSpecularGlossiness.specularGlossinessTexture !== undefined ) {

				const specGlossMapDef = pbrSpecularGlossiness.specularGlossinessTexture;
				pending.push( parser.assignTexture( materialParams, 'glossinessMap', specGlossMapDef ) );
				pending.push( parser.assignTexture( materialParams, 'specularMap', specGlossMapDef ) );

			}

			return Promise.all( pending );

		}

		createMaterial( materialParams ) {

			const material = new GLTFMeshStandardSGMaterial( materialParams );
			material.fog = true;
			material.color = materialParams.color;
			material.map = materialParams.map === undefined ? null : materialParams.map;
			material.lightMap = null;
			material.lightMapIntensity = 1.0;
			material.aoMap = materialParams.aoMap === undefined ? null : materialParams.aoMap;
			material.aoMapIntensity = 1.0;
			material.emissive = materialParams.emissive;
			material.emissiveIntensity = 1.0;
			material.emissiveMap = materialParams.emissiveMap === undefined ? null : materialParams.emissiveMap;
			material.bumpMap = materialParams.bumpMap === undefined ? null : materialParams.bumpMap;
			material.bumpScale = 1;
			material.normalMap = materialParams.normalMap === undefined ? null : materialParams.normalMap;
			material.normalMapType = THREE.TangentSpaceNormalMap;
			if ( materialParams.normalScale ) material.normalScale = materialParams.normalScale;
			material.displacementMap = null;
			material.displacementScale = 1;
			material.displacementBias = 0;
			material.specularMap = materialParams.specularMap === undefined ? null : materialParams.specularMap;
			material.specular = materialParams.specular;
			material.glossinessMap = materialParams.glossinessMap === undefined ? null : materialParams.glossinessMap;
			material.glossiness = materialParams.glossiness;
			material.alphaMap = null;
			material.envMap = materialParams.envMap === undefined ? null : materialParams.envMap;
			material.envMapIntensity = 1.0;
			material.refractionRatio = 0.98;
			return material;

		}

	}
	/**
 * THREE.Mesh Quantization Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_mesh_quantization
 */


	class GLTFMeshQuantizationExtension {

		constructor() {

			this.name = EXTENSIONS.KHR_MESH_QUANTIZATION;

		}

	}
	/*********************************/

	/********** INTERPOLATION ********/

	/*********************************/
	// Spline Interpolation
	// Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#appendix-c-spline-interpolation


	class GLTFCubicSplineInterpolant extends THREE.Interpolant {

		constructor( parameterPositions, sampleValues, sampleSize, resultBuffer ) {

			super( parameterPositions, sampleValues, sampleSize, resultBuffer );

		}

		copySampleValue_( index ) {

			// Copies a sample value to the result buffer. See description of glTF
			// CUBICSPLINE values layout in interpolate_() function below.
			const result = this.resultBuffer,
				values = this.sampleValues,
				valueSize = this.valueSize,
				offset = index * valueSize * 3 + valueSize;

			for ( let i = 0; i !== valueSize; i ++ ) {

				result[ i ] = values[ offset + i ];

			}

			return result;

		}

	}

	GLTFCubicSplineInterpolant.prototype.beforeStart_ = GLTFCubicSplineInterpolant.prototype.copySampleValue_;
	GLTFCubicSplineInterpolant.prototype.afterEnd_ = GLTFCubicSplineInterpolant.prototype.copySampleValue_;

	GLTFCubicSplineInterpolant.prototype.interpolate_ = function ( i1, t0, t, t1 ) {

		const result = this.resultBuffer;
		const values = this.sampleValues;
		const stride = this.valueSize;
		const stride2 = stride * 2;
		const stride3 = stride * 3;
		const td = t1 - t0;
		const p = ( t - t0 ) / td;
		const pp = p * p;
		const ppp = pp * p;
		const offset1 = i1 * stride3;
		const offset0 = offset1 - stride3;
		const s2 = - 2 * ppp + 3 * pp;
		const s3 = ppp - pp;
		const s0 = 1 - s2;
		const s1 = s3 - pp + p; // Layout of keyframe output values for CUBICSPLINE animations:
		//   [ inTangent_1, splineVertex_1, outTangent_1, inTangent_2, splineVertex_2, ... ]

		for ( let i = 0; i !== stride; i ++ ) {

			const p0 = values[ offset0 + i + stride ]; // splineVertex_k

			const m0 = values[ offset0 + i + stride2 ] * td; // outTangent_k * (t_k+1 - t_k)

			const p1 = values[ offset1 + i + stride ]; // splineVertex_k+1

			const m1 = values[ offset1 + i ] * td; // inTangent_k+1 * (t_k+1 - t_k)

			result[ i ] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1;

		}

		return result;

	};
	/*********************************/

	/********** INTERNALS ************/

	/*********************************/

	/* CONSTANTS */


	const WEBGL_CONSTANTS = {
		FLOAT: 5126,
		//FLOAT_MAT2: 35674,
		FLOAT_MAT3: 35675,
		FLOAT_MAT4: 35676,
		FLOAT_VEC2: 35664,
		FLOAT_VEC3: 35665,
		FLOAT_VEC4: 35666,
		LINEAR: 9729,
		REPEAT: 10497,
		SAMPLER_2D: 35678,
		POINTS: 0,
		LINES: 1,
		LINE_LOOP: 2,
		LINE_STRIP: 3,
		TRIANGLES: 4,
		TRIANGLE_STRIP: 5,
		TRIANGLE_FAN: 6,
		UNSIGNED_BYTE: 5121,
		UNSIGNED_SHORT: 5123
	};
	const WEBGL_COMPONENT_TYPES = {
		5120: Int8Array,
		5121: Uint8Array,
		5122: Int16Array,
		5123: Uint16Array,
		5125: Uint32Array,
		5126: Float32Array
	};
	const WEBGL_FILTERS = {
		9728: THREE.NearestFilter,
		9729: THREE.LinearFilter,
		9984: THREE.NearestMipmapNearestFilter,
		9985: THREE.LinearMipmapNearestFilter,
		9986: THREE.NearestMipmapLinearFilter,
		9987: THREE.LinearMipmapLinearFilter
	};
	const WEBGL_WRAPPINGS = {
		33071: THREE.ClampToEdgeWrapping,
		33648: THREE.MirroredRepeatWrapping,
		10497: THREE.RepeatWrapping
	};
	const WEBGL_TYPE_SIZES = {
		'SCALAR': 1,
		'VEC2': 2,
		'VEC3': 3,
		'VEC4': 4,
		'MAT2': 4,
		'MAT3': 9,
		'MAT4': 16
	};
	const ATTRIBUTES = {
		POSITION: 'position',
		NORMAL: 'normal',
		TANGENT: 'tangent',
		TEXCOORD_0: 'uv',
		TEXCOORD_1: 'uv2',
		COLOR_0: 'color',
		WEIGHTS_0: 'skinWeight',
		JOINTS_0: 'skinIndex'
	};
	const PATH_PROPERTIES = {
		scale: 'scale',
		translation: 'position',
		rotation: 'quaternion',
		weights: 'morphTargetInfluences'
	};
	const INTERPOLATION = {
		CUBICSPLINE: undefined,
		// We use a custom interpolant (GLTFCubicSplineInterpolation) for CUBICSPLINE tracks. Each
		// keyframe track will be initialized with a default interpolation type, then modified.
		LINEAR: THREE.InterpolateLinear,
		STEP: THREE.InterpolateDiscrete
	};
	const ALPHA_MODES = {
		OPAQUE: 'OPAQUE',
		MASK: 'MASK',
		BLEND: 'BLEND'
	};
	/* UTILITY FUNCTIONS */

	function resolveURL( url, path ) {

		// Invalid URL
		if ( typeof url !== 'string' || url === '' ) return ''; // Host Relative URL

		if ( /^https?:\/\//i.test( path ) && /^\//.test( url ) ) {

			path = path.replace( /(^https?:\/\/[^\/]+).*/i, '$1' );

		} // Absolute URL http://,https://,//


		if ( /^(https?:)?\/\//i.test( url ) ) return url; // Data URI

		if ( /^data:.*,.*$/i.test( url ) ) return url; // Blob URL

		if ( /^blob:.*$/i.test( url ) ) return url; // Relative URL

		return path + url;

	}
	/**
 * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#default-material
 */


	function createDefaultMaterial( cache ) {

		if ( cache[ 'DefaultMaterial' ] === undefined ) {

			cache[ 'DefaultMaterial' ] = new THREE.MeshStandardMaterial( {
				color: 0xFFFFFF,
				emissive: 0x000000,
				metalness: 1,
				roughness: 1,
				transparent: false,
				depthTest: true,
				side: THREE.FrontSide
			} );

		}

		return cache[ 'DefaultMaterial' ];

	}

	function addUnknownExtensionsToUserData( knownExtensions, object, objectDef ) {

		// Add unknown glTF extensions to an object's userData.
		for ( const name in objectDef.extensions ) {

			if ( knownExtensions[ name ] === undefined ) {

				object.userData.gltfExtensions = object.userData.gltfExtensions || {};
				object.userData.gltfExtensions[ name ] = objectDef.extensions[ name ];

			}

		}

	}
	/**
 * @param {Object3D|Material|BufferGeometry} object
 * @param {GLTF.definition} gltfDef
 */


	function assignExtrasToUserData( object, gltfDef ) {

		if ( gltfDef.extras !== undefined ) {

			if ( typeof gltfDef.extras === 'object' ) {

				Object.assign( object.userData, gltfDef.extras );

			} else {

				console.warn( 'THREE.GLTFLoader: Ignoring primitive type .extras, ' + gltfDef.extras );

			}

		}

	}
	/**
 * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#morph-targets
 *
 * @param {BufferGeometry} geometry
 * @param {Array<GLTF.Target>} targets
 * @param {GLTFParser} parser
 * @return {Promise<BufferGeometry>}
 */


	function addMorphTargets( geometry, targets, parser ) {

		let hasMorphPosition = false;
		let hasMorphNormal = false;

		for ( let i = 0, il = targets.length; i < il; i ++ ) {

			const target = targets[ i ];
			if ( target.POSITION !== undefined ) hasMorphPosition = true;
			if ( target.NORMAL !== undefined ) hasMorphNormal = true;
			if ( hasMorphPosition && hasMorphNormal ) break;

		}

		if ( ! hasMorphPosition && ! hasMorphNormal ) return Promise.resolve( geometry );
		const pendingPositionAccessors = [];
		const pendingNormalAccessors = [];

		for ( let i = 0, il = targets.length; i < il; i ++ ) {

			const target = targets[ i ];

			if ( hasMorphPosition ) {

				const pendingAccessor = target.POSITION !== undefined ? parser.getDependency( 'accessor', target.POSITION ) : geometry.attributes.position;
				pendingPositionAccessors.push( pendingAccessor );

			}

			if ( hasMorphNormal ) {

				const pendingAccessor = target.NORMAL !== undefined ? parser.getDependency( 'accessor', target.NORMAL ) : geometry.attributes.normal;
				pendingNormalAccessors.push( pendingAccessor );

			}

		}

		return Promise.all( [ Promise.all( pendingPositionAccessors ), Promise.all( pendingNormalAccessors ) ] ).then( function ( accessors ) {

			const morphPositions = accessors[ 0 ];
			const morphNormals = accessors[ 1 ];
			if ( hasMorphPosition ) geometry.morphAttributes.position = morphPositions;
			if ( hasMorphNormal ) geometry.morphAttributes.normal = morphNormals;
			geometry.morphTargetsRelative = true;
			return geometry;

		} );

	}
	/**
 * @param {Mesh} mesh
 * @param {GLTF.Mesh} meshDef
 */


	function updateMorphTargets( mesh, meshDef ) {

		mesh.updateMorphTargets();

		if ( meshDef.weights !== undefined ) {

			for ( let i = 0, il = meshDef.weights.length; i < il; i ++ ) {

				mesh.morphTargetInfluences[ i ] = meshDef.weights[ i ];

			}

		} // .extras has user-defined data, so check that .extras.targetNames is an array.


		if ( meshDef.extras && Array.isArray( meshDef.extras.targetNames ) ) {

			const targetNames = meshDef.extras.targetNames;

			if ( mesh.morphTargetInfluences.length === targetNames.length ) {

				mesh.morphTargetDictionary = {};

				for ( let i = 0, il = targetNames.length; i < il; i ++ ) {

					mesh.morphTargetDictionary[ targetNames[ i ] ] = i;

				}

			} else {

				console.warn( 'THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.' );

			}

		}

	}

	function createPrimitiveKey( primitiveDef ) {

		const dracoExtension = primitiveDef.extensions && primitiveDef.extensions[ EXTENSIONS.KHR_DRACO_MESH_COMPRESSION ];
		let geometryKey;

		if ( dracoExtension ) {

			geometryKey = 'draco:' + dracoExtension.bufferView + ':' + dracoExtension.indices + ':' + createAttributesKey( dracoExtension.attributes );

		} else {

			geometryKey = primitiveDef.indices + ':' + createAttributesKey( primitiveDef.attributes ) + ':' + primitiveDef.mode;

		}

		return geometryKey;

	}

	function createAttributesKey( attributes ) {

		let attributesKey = '';
		const keys = Object.keys( attributes ).sort();

		for ( let i = 0, il = keys.length; i < il; i ++ ) {

			attributesKey += keys[ i ] + ':' + attributes[ keys[ i ] ] + ';';

		}

		return attributesKey;

	}

	function getNormalizedComponentScale( constructor ) {

		// Reference:
		// https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_mesh_quantization#encoding-quantized-data
		switch ( constructor ) {

			case Int8Array:
				return 1 / 127;

			case Uint8Array:
				return 1 / 255;

			case Int16Array:
				return 1 / 32767;

			case Uint16Array:
				return 1 / 65535;

			default:
				throw new Error( 'THREE.GLTFLoader: Unsupported normalized accessor component type.' );

		}

	}
	/* GLTF PARSER */


	class GLTFParser {

		constructor( json = {}, options = {} ) {

			this.json = json;
			this.extensions = {};
			this.plugins = {};
			this.options = options; // loader object cache

			this.cache = new GLTFRegistry(); // associations between Three.js objects and glTF elements

			this.associations = new Map(); // THREE.BufferGeometry caching

			this.primitiveCache = {}; // THREE.Object3D instance caches

			this.meshCache = {
				refs: {},
				uses: {}
			};
			this.cameraCache = {
				refs: {},
				uses: {}
			};
			this.lightCache = {
				refs: {},
				uses: {}
			};
			this.textureCache = {}; // Track node names, to ensure no duplicates

			this.nodeNamesUsed = {}; // Use an THREE.ImageBitmapLoader if imageBitmaps are supported. Moves much of the
			// expensive work of uploading a texture to the GPU off the main thread.

			if ( typeof createImageBitmap !== 'undefined' && /Firefox/.test( navigator.userAgent ) === false ) {

				this.textureLoader = new THREE.ImageBitmapLoader( this.options.manager );

			} else {

				this.textureLoader = new THREE.TextureLoader( this.options.manager );

			}

			this.textureLoader.setCrossOrigin( this.options.crossOrigin );
			this.textureLoader.setRequestHeader( this.options.requestHeader );
			this.fileLoader = new THREE.FileLoader( this.options.manager );
			this.fileLoader.setResponseType( 'arraybuffer' );

			if ( this.options.crossOrigin === 'use-credentials' ) {

				this.fileLoader.setWithCredentials( true );

			}

		}

		setExtensions( extensions ) {

			this.extensions = extensions;

		}

		setPlugins( plugins ) {

			this.plugins = plugins;

		}

		parse( onLoad, onError ) {

			const parser = this;
			const json = this.json;
			const extensions = this.extensions; // Clear the loader cache

			this.cache.removeAll(); // Mark the special nodes/meshes in json for efficient parse

			this._invokeAll( function ( ext ) {

				return ext._markDefs && ext._markDefs();

			} );

			Promise.all( this._invokeAll( function ( ext ) {

				return ext.beforeRoot && ext.beforeRoot();

			} ) ).then( function () {

				return Promise.all( [ parser.getDependencies( 'scene' ), parser.getDependencies( 'animation' ), parser.getDependencies( 'camera' ) ] );

			} ).then( function ( dependencies ) {

				const result = {
					scene: dependencies[ 0 ][ json.scene || 0 ],
					scenes: dependencies[ 0 ],
					animations: dependencies[ 1 ],
					cameras: dependencies[ 2 ],
					asset: json.asset,
					parser: parser,
					userData: {}
				};
				addUnknownExtensionsToUserData( extensions, result, json );
				assignExtrasToUserData( result, json );
				Promise.all( parser._invokeAll( function ( ext ) {

					return ext.afterRoot && ext.afterRoot( result );

				} ) ).then( function () {

					onLoad( result );

				} );

			} ).catch( onError );

		}
		/**
   * Marks the special nodes/meshes in json for efficient parse.
   */


		_markDefs() {

			const nodeDefs = this.json.nodes || [];
			const skinDefs = this.json.skins || [];
			const meshDefs = this.json.meshes || []; // Nothing in the node definition indicates whether it is a THREE.Bone or an
			// THREE.Object3D. Use the skins' joint references to mark bones.

			for ( let skinIndex = 0, skinLength = skinDefs.length; skinIndex < skinLength; skinIndex ++ ) {

				const joints = skinDefs[ skinIndex ].joints;

				for ( let i = 0, il = joints.length; i < il; i ++ ) {

					nodeDefs[ joints[ i ] ].isBone = true;

				}

			} // Iterate over all nodes, marking references to shared resources,
			// as well as skeleton joints.


			for ( let nodeIndex = 0, nodeLength = nodeDefs.length; nodeIndex < nodeLength; nodeIndex ++ ) {

				const nodeDef = nodeDefs[ nodeIndex ];

				if ( nodeDef.mesh !== undefined ) {

					this._addNodeRef( this.meshCache, nodeDef.mesh ); // Nothing in the mesh definition indicates whether it is
					// a THREE.SkinnedMesh or THREE.Mesh. Use the node's mesh reference
					// to mark THREE.SkinnedMesh if node has skin.


					if ( nodeDef.skin !== undefined ) {

						meshDefs[ nodeDef.mesh ].isSkinnedMesh = true;

					}

				}

				if ( nodeDef.camera !== undefined ) {

					this._addNodeRef( this.cameraCache, nodeDef.camera );

				}

			}

		}
		/**
   * Counts references to shared node / THREE.Object3D resources. These resources
   * can be reused, or "instantiated", at multiple nodes in the scene
   * hierarchy. THREE.Mesh, Camera, and Light instances are instantiated and must
   * be marked. Non-scenegraph resources (like Materials, Geometries, and
   * Textures) can be reused directly and are not marked here.
   *
   * Example: CesiumMilkTruck sample model reuses "Wheel" meshes.
   */


		_addNodeRef( cache, index ) {

			if ( index === undefined ) return;

			if ( cache.refs[ index ] === undefined ) {

				cache.refs[ index ] = cache.uses[ index ] = 0;

			}

			cache.refs[ index ] ++;

		}
		/** Returns a reference to a shared resource, cloning it if necessary. */


		_getNodeRef( cache, index, object ) {

			if ( cache.refs[ index ] <= 1 ) return object;
			const ref = object.clone();
			ref.name += '_instance_' + cache.uses[ index ] ++;
			return ref;

		}

		_invokeOne( func ) {

			const extensions = Object.values( this.plugins );
			extensions.push( this );

			for ( let i = 0; i < extensions.length; i ++ ) {

				const result = func( extensions[ i ] );
				if ( result ) return result;

			}

			return null;

		}

		_invokeAll( func ) {

			const extensions = Object.values( this.plugins );
			extensions.unshift( this );
			const pending = [];

			for ( let i = 0; i < extensions.length; i ++ ) {

				const result = func( extensions[ i ] );
				if ( result ) pending.push( result );

			}

			return pending;

		}
		/**
   * Requests the specified dependency asynchronously, with caching.
   * @param {string} type
   * @param {number} index
   * @return {Promise<Object3D|Material|THREE.Texture|AnimationClip|ArrayBuffer|Object>}
   */


		getDependency( type, index ) {

			const cacheKey = type + ':' + index;
			let dependency = this.cache.get( cacheKey );

			if ( ! dependency ) {

				switch ( type ) {

					case 'scene':
						dependency = this.loadScene( index );
						break;

					case 'node':
						dependency = this.loadNode( index );
						break;

					case 'mesh':
						dependency = this._invokeOne( function ( ext ) {

							return ext.loadMesh && ext.loadMesh( index );

						} );
						break;

					case 'accessor':
						dependency = this.loadAccessor( index );
						break;

					case 'bufferView':
						dependency = this._invokeOne( function ( ext ) {

							return ext.loadBufferView && ext.loadBufferView( index );

						} );
						break;

					case 'buffer':
						dependency = this.loadBuffer( index );
						break;

					case 'material':
						dependency = this._invokeOne( function ( ext ) {

							return ext.loadMaterial && ext.loadMaterial( index );

						} );
						break;

					case 'texture':
						dependency = this._invokeOne( function ( ext ) {

							return ext.loadTexture && ext.loadTexture( index );

						} );
						break;

					case 'skin':
						dependency = this.loadSkin( index );
						break;

					case 'animation':
						dependency = this.loadAnimation( index );
						break;

					case 'camera':
						dependency = this.loadCamera( index );
						break;

					default:
						throw new Error( 'Unknown type: ' + type );

				}

				this.cache.add( cacheKey, dependency );

			}

			return dependency;

		}
		/**
   * Requests all dependencies of the specified type asynchronously, with caching.
   * @param {string} type
   * @return {Promise<Array<Object>>}
   */


		getDependencies( type ) {

			let dependencies = this.cache.get( type );

			if ( ! dependencies ) {

				const parser = this;
				const defs = this.json[ type + ( type === 'mesh' ? 'es' : 's' ) ] || [];
				dependencies = Promise.all( defs.map( function ( def, index ) {

					return parser.getDependency( type, index );

				} ) );
				this.cache.add( type, dependencies );

			}

			return dependencies;

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#buffers-and-buffer-views
   * @param {number} bufferIndex
   * @return {Promise<ArrayBuffer>}
   */


		loadBuffer( bufferIndex ) {

			const bufferDef = this.json.buffers[ bufferIndex ];
			const loader = this.fileLoader;

			if ( bufferDef.type && bufferDef.type !== 'arraybuffer' ) {

				throw new Error( 'THREE.GLTFLoader: ' + bufferDef.type + ' buffer type is not supported.' );

			} // If present, GLB container is required to be the first buffer.


			if ( bufferDef.uri === undefined && bufferIndex === 0 ) {

				return Promise.resolve( this.extensions[ EXTENSIONS.KHR_BINARY_GLTF ].body );

			}

			const options = this.options;
			return new Promise( function ( resolve, reject ) {

				loader.load( resolveURL( bufferDef.uri, options.path ), resolve, undefined, function () {

					reject( new Error( 'THREE.GLTFLoader: Failed to load buffer "' + bufferDef.uri + '".' ) );

				} );

			} );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#buffers-and-buffer-views
   * @param {number} bufferViewIndex
   * @return {Promise<ArrayBuffer>}
   */


		loadBufferView( bufferViewIndex ) {

			const bufferViewDef = this.json.bufferViews[ bufferViewIndex ];
			return this.getDependency( 'buffer', bufferViewDef.buffer ).then( function ( buffer ) {

				const byteLength = bufferViewDef.byteLength || 0;
				const byteOffset = bufferViewDef.byteOffset || 0;
				return buffer.slice( byteOffset, byteOffset + byteLength );

			} );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#accessors
   * @param {number} accessorIndex
   * @return {Promise<BufferAttribute|InterleavedBufferAttribute>}
   */


		loadAccessor( accessorIndex ) {

			const parser = this;
			const json = this.json;
			const accessorDef = this.json.accessors[ accessorIndex ];

			if ( accessorDef.bufferView === undefined && accessorDef.sparse === undefined ) {

				// Ignore empty accessors, which may be used to declare runtime
				// information about attributes coming from another source (e.g. Draco
				// compression extension).
				return Promise.resolve( null );

			}

			const pendingBufferViews = [];

			if ( accessorDef.bufferView !== undefined ) {

				pendingBufferViews.push( this.getDependency( 'bufferView', accessorDef.bufferView ) );

			} else {

				pendingBufferViews.push( null );

			}

			if ( accessorDef.sparse !== undefined ) {

				pendingBufferViews.push( this.getDependency( 'bufferView', accessorDef.sparse.indices.bufferView ) );
				pendingBufferViews.push( this.getDependency( 'bufferView', accessorDef.sparse.values.bufferView ) );

			}

			return Promise.all( pendingBufferViews ).then( function ( bufferViews ) {

				const bufferView = bufferViews[ 0 ];
				const itemSize = WEBGL_TYPE_SIZES[ accessorDef.type ];
				const TypedArray = WEBGL_COMPONENT_TYPES[ accessorDef.componentType ]; // For VEC3: itemSize is 3, elementBytes is 4, itemBytes is 12.

				const elementBytes = TypedArray.BYTES_PER_ELEMENT;
				const itemBytes = elementBytes * itemSize;
				const byteOffset = accessorDef.byteOffset || 0;
				const byteStride = accessorDef.bufferView !== undefined ? json.bufferViews[ accessorDef.bufferView ].byteStride : undefined;
				const normalized = accessorDef.normalized === true;
				let array, bufferAttribute; // The buffer is not interleaved if the stride is the item size in bytes.

				if ( byteStride && byteStride !== itemBytes ) {

					// Each "slice" of the buffer, as defined by 'count' elements of 'byteStride' bytes, gets its own THREE.InterleavedBuffer
					// This makes sure that IBA.count reflects accessor.count properly
					const ibSlice = Math.floor( byteOffset / byteStride );
					const ibCacheKey = 'InterleavedBuffer:' + accessorDef.bufferView + ':' + accessorDef.componentType + ':' + ibSlice + ':' + accessorDef.count;
					let ib = parser.cache.get( ibCacheKey );

					if ( ! ib ) {

						array = new TypedArray( bufferView, ibSlice * byteStride, accessorDef.count * byteStride / elementBytes ); // Integer parameters to IB/IBA are in array elements, not bytes.

						ib = new THREE.InterleavedBuffer( array, byteStride / elementBytes );
						parser.cache.add( ibCacheKey, ib );

					}

					bufferAttribute = new THREE.InterleavedBufferAttribute( ib, itemSize, byteOffset % byteStride / elementBytes, normalized );

				} else {

					if ( bufferView === null ) {

						array = new TypedArray( accessorDef.count * itemSize );

					} else {

						array = new TypedArray( bufferView, byteOffset, accessorDef.count * itemSize );

					}

					bufferAttribute = new THREE.BufferAttribute( array, itemSize, normalized );

				} // https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#sparse-accessors


				if ( accessorDef.sparse !== undefined ) {

					const itemSizeIndices = WEBGL_TYPE_SIZES.SCALAR;
					const TypedArrayIndices = WEBGL_COMPONENT_TYPES[ accessorDef.sparse.indices.componentType ];
					const byteOffsetIndices = accessorDef.sparse.indices.byteOffset || 0;
					const byteOffsetValues = accessorDef.sparse.values.byteOffset || 0;
					const sparseIndices = new TypedArrayIndices( bufferViews[ 1 ], byteOffsetIndices, accessorDef.sparse.count * itemSizeIndices );
					const sparseValues = new TypedArray( bufferViews[ 2 ], byteOffsetValues, accessorDef.sparse.count * itemSize );

					if ( bufferView !== null ) {

						// Avoid modifying the original ArrayBuffer, if the bufferView wasn't initialized with zeroes.
						bufferAttribute = new THREE.BufferAttribute( bufferAttribute.array.slice(), bufferAttribute.itemSize, bufferAttribute.normalized );

					}

					for ( let i = 0, il = sparseIndices.length; i < il; i ++ ) {

						const index = sparseIndices[ i ];
						bufferAttribute.setX( index, sparseValues[ i * itemSize ] );
						if ( itemSize >= 2 ) bufferAttribute.setY( index, sparseValues[ i * itemSize + 1 ] );
						if ( itemSize >= 3 ) bufferAttribute.setZ( index, sparseValues[ i * itemSize + 2 ] );
						if ( itemSize >= 4 ) bufferAttribute.setW( index, sparseValues[ i * itemSize + 3 ] );
						if ( itemSize >= 5 ) throw new Error( 'THREE.GLTFLoader: Unsupported itemSize in sparse THREE.BufferAttribute.' );

					}

				}

				return bufferAttribute;

			} );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#textures
   * @param {number} textureIndex
   * @return {Promise<THREE.Texture>}
   */


		loadTexture( textureIndex ) {

			const json = this.json;
			const options = this.options;
			const textureDef = json.textures[ textureIndex ];
			const source = json.images[ textureDef.source ];
			let loader = this.textureLoader;

			if ( source.uri ) {

				const handler = options.manager.getHandler( source.uri );
				if ( handler !== null ) loader = handler;

			}

			return this.loadTextureImage( textureIndex, source, loader );

		}

		loadTextureImage( textureIndex, source, loader ) {

			const parser = this;
			const json = this.json;
			const options = this.options;
			const textureDef = json.textures[ textureIndex ];
			const cacheKey = ( source.uri || source.bufferView ) + ':' + textureDef.sampler;

			if ( this.textureCache[ cacheKey ] ) {

				// See https://github.com/mrdoob/three.js/issues/21559.
				return this.textureCache[ cacheKey ];

			}

			const URL = self.URL || self.webkitURL;
			let sourceURI = source.uri || '';
			let isObjectURL = false;
			let hasAlpha = true;
			const isJPEG = sourceURI.search( /\.jpe?g($|\?)/i ) > 0 || sourceURI.search( /^data\:image\/jpeg/ ) === 0;
			if ( source.mimeType === 'image/jpeg' || isJPEG ) hasAlpha = false;

			if ( source.bufferView !== undefined ) {

				// Load binary image data from bufferView, if provided.
				sourceURI = parser.getDependency( 'bufferView', source.bufferView ).then( function ( bufferView ) {

					if ( source.mimeType === 'image/png' ) {

						// Inspect the PNG 'IHDR' chunk to determine whether the image could have an
						// alpha channel. This check is conservative — the image could have an alpha
						// channel with all values == 1, and the indexed type (colorType == 3) only
						// sometimes contains alpha.
						//
						// https://en.wikipedia.org/wiki/Portable_Network_Graphics#File_header
						const colorType = new DataView( bufferView, 25, 1 ).getUint8( 0, false );
						hasAlpha = colorType === 6 || colorType === 4 || colorType === 3;

					}

					isObjectURL = true;
					const blob = new Blob( [ bufferView ], {
						type: source.mimeType
					} );
					sourceURI = URL.createObjectURL( blob );
					return sourceURI;

				} );

			} else if ( source.uri === undefined ) {

				throw new Error( 'THREE.GLTFLoader: Image ' + textureIndex + ' is missing URI and bufferView' );

			}

			const promise = Promise.resolve( sourceURI ).then( function ( sourceURI ) {

				return new Promise( function ( resolve, reject ) {

					let onLoad = resolve;

					if ( loader.isImageBitmapLoader === true ) {

						onLoad = function ( imageBitmap ) {

							resolve( new THREE.CanvasTexture( imageBitmap ) );

						};

					}

					loader.load( resolveURL( sourceURI, options.path ), onLoad, undefined, reject );

				} );

			} ).then( function ( texture ) {

				// Clean up resources and configure Texture.
				if ( isObjectURL === true ) {

					URL.revokeObjectURL( sourceURI );

				}

				texture.flipY = false;
				if ( textureDef.name ) texture.name = textureDef.name; // When there is definitely no alpha channel in the texture, set THREE.RGBFormat to save space.

				if ( ! hasAlpha ) texture.format = THREE.RGBFormat;
				const samplers = json.samplers || {};
				const sampler = samplers[ textureDef.sampler ] || {};
				texture.magFilter = WEBGL_FILTERS[ sampler.magFilter ] || THREE.LinearFilter;
				texture.minFilter = WEBGL_FILTERS[ sampler.minFilter ] || THREE.LinearMipmapLinearFilter;
				texture.wrapS = WEBGL_WRAPPINGS[ sampler.wrapS ] || THREE.RepeatWrapping;
				texture.wrapT = WEBGL_WRAPPINGS[ sampler.wrapT ] || THREE.RepeatWrapping;
				parser.associations.set( texture, {
					type: 'textures',
					index: textureIndex
				} );
				return texture;

			} );
			this.textureCache[ cacheKey ] = promise;
			return promise;

		}
		/**
   * Asynchronously assigns a texture to the given material parameters.
   * @param {Object} materialParams
   * @param {string} mapName
   * @param {Object} mapDef
   * @return {Promise}
   */


		assignTexture( materialParams, mapName, mapDef ) {

			const parser = this;
			return this.getDependency( 'texture', mapDef.index ).then( function ( texture ) {

				// Materials sample aoMap from UV set 1 and other maps from UV set 0 - this can't be configured
				// However, we will copy UV set 0 to UV set 1 on demand for aoMap
				if ( mapDef.texCoord !== undefined && mapDef.texCoord != 0 && ! ( mapName === 'aoMap' && mapDef.texCoord == 1 ) ) {

					console.warn( 'THREE.GLTFLoader: Custom UV set ' + mapDef.texCoord + ' for texture ' + mapName + ' not yet supported.' );

				}

				if ( parser.extensions[ EXTENSIONS.KHR_TEXTURE_TRANSFORM ] ) {

					const transform = mapDef.extensions !== undefined ? mapDef.extensions[ EXTENSIONS.KHR_TEXTURE_TRANSFORM ] : undefined;

					if ( transform ) {

						const gltfReference = parser.associations.get( texture );
						texture = parser.extensions[ EXTENSIONS.KHR_TEXTURE_TRANSFORM ].extendTexture( texture, transform );
						parser.associations.set( texture, gltfReference );

					}

				}

				materialParams[ mapName ] = texture;

			} );

		}
		/**
   * Assigns final material to a THREE.Mesh, THREE.Line, or THREE.Points instance. The instance
   * already has a material (generated from the glTF material options alone)
   * but reuse of the same glTF material may require multiple threejs materials
   * to accommodate different primitive types, defines, etc. New materials will
   * be created if necessary, and reused from a cache.
   * @param  {Object3D} mesh THREE.Mesh, THREE.Line, or THREE.Points instance.
   */


		assignFinalMaterial( mesh ) {

			const geometry = mesh.geometry;
			let material = mesh.material;
			const useVertexTangents = geometry.attributes.tangent !== undefined;
			const useVertexColors = geometry.attributes.color !== undefined;
			const useFlatShading = geometry.attributes.normal === undefined;
			const useMorphTargets = Object.keys( geometry.morphAttributes ).length > 0;
			const useMorphNormals = useMorphTargets && geometry.morphAttributes.normal !== undefined;

			if ( mesh.isPoints ) {

				const cacheKey = 'PointsMaterial:' + material.uuid;
				let pointsMaterial = this.cache.get( cacheKey );

				if ( ! pointsMaterial ) {

					pointsMaterial = new THREE.PointsMaterial();
					THREE.Material.prototype.copy.call( pointsMaterial, material );
					pointsMaterial.color.copy( material.color );
					pointsMaterial.map = material.map;
					pointsMaterial.sizeAttenuation = false; // glTF spec says points should be 1px

					this.cache.add( cacheKey, pointsMaterial );

				}

				material = pointsMaterial;

			} else if ( mesh.isLine ) {

				const cacheKey = 'LineBasicMaterial:' + material.uuid;
				let lineMaterial = this.cache.get( cacheKey );

				if ( ! lineMaterial ) {

					lineMaterial = new THREE.LineBasicMaterial();
					THREE.Material.prototype.copy.call( lineMaterial, material );
					lineMaterial.color.copy( material.color );
					this.cache.add( cacheKey, lineMaterial );

				}

				material = lineMaterial;

			} // Clone the material if it will be modified


			if ( useVertexTangents || useVertexColors || useFlatShading || useMorphTargets ) {

				let cacheKey = 'ClonedMaterial:' + material.uuid + ':';
				if ( material.isGLTFSpecularGlossinessMaterial ) cacheKey += 'specular-glossiness:';
				if ( useVertexTangents ) cacheKey += 'vertex-tangents:';
				if ( useVertexColors ) cacheKey += 'vertex-colors:';
				if ( useFlatShading ) cacheKey += 'flat-shading:';
				if ( useMorphTargets ) cacheKey += 'morph-targets:';
				if ( useMorphNormals ) cacheKey += 'morph-normals:';
				let cachedMaterial = this.cache.get( cacheKey );

				if ( ! cachedMaterial ) {

					cachedMaterial = material.clone();
					if ( useVertexColors ) cachedMaterial.vertexColors = true;
					if ( useFlatShading ) cachedMaterial.flatShading = true;
					if ( useMorphTargets ) cachedMaterial.morphTargets = true;
					if ( useMorphNormals ) cachedMaterial.morphNormals = true;

					if ( useVertexTangents ) {

						cachedMaterial.vertexTangents = true; // https://github.com/mrdoob/three.js/issues/11438#issuecomment-507003995

						if ( cachedMaterial.normalScale ) cachedMaterial.normalScale.y *= - 1;
						if ( cachedMaterial.clearcoatNormalScale ) cachedMaterial.clearcoatNormalScale.y *= - 1;

					}

					this.cache.add( cacheKey, cachedMaterial );
					this.associations.set( cachedMaterial, this.associations.get( material ) );

				}

				material = cachedMaterial;

			} // workarounds for mesh and geometry


			if ( material.aoMap && geometry.attributes.uv2 === undefined && geometry.attributes.uv !== undefined ) {

				geometry.setAttribute( 'uv2', geometry.attributes.uv );

			}

			mesh.material = material;

		}

		getMaterialType( ) {

			return THREE.MeshStandardMaterial;

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#materials
   * @param {number} materialIndex
   * @return {Promise<Material>}
   */


		loadMaterial( materialIndex ) {

			const parser = this;
			const json = this.json;
			const extensions = this.extensions;
			const materialDef = json.materials[ materialIndex ];
			let materialType;
			const materialParams = {};
			const materialExtensions = materialDef.extensions || {};
			const pending = [];

			if ( materialExtensions[ EXTENSIONS.KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS ] ) {

				const sgExtension = extensions[ EXTENSIONS.KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS ];
				materialType = sgExtension.getMaterialType();
				pending.push( sgExtension.extendParams( materialParams, materialDef, parser ) );

			} else if ( materialExtensions[ EXTENSIONS.KHR_MATERIALS_UNLIT ] ) {

				const kmuExtension = extensions[ EXTENSIONS.KHR_MATERIALS_UNLIT ];
				materialType = kmuExtension.getMaterialType();
				pending.push( kmuExtension.extendParams( materialParams, materialDef, parser ) );

			} else {

				// Specification:
				// https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#metallic-roughness-material
				const metallicRoughness = materialDef.pbrMetallicRoughness || {};
				materialParams.color = new THREE.Color( 1.0, 1.0, 1.0 );
				materialParams.opacity = 1.0;

				if ( Array.isArray( metallicRoughness.baseColorFactor ) ) {

					const array = metallicRoughness.baseColorFactor;
					materialParams.color.fromArray( array );
					materialParams.opacity = array[ 3 ];

				}

				if ( metallicRoughness.baseColorTexture !== undefined ) {

					pending.push( parser.assignTexture( materialParams, 'map', metallicRoughness.baseColorTexture ) );

				}

				materialParams.metalness = metallicRoughness.metallicFactor !== undefined ? metallicRoughness.metallicFactor : 1.0;
				materialParams.roughness = metallicRoughness.roughnessFactor !== undefined ? metallicRoughness.roughnessFactor : 1.0;

				if ( metallicRoughness.metallicRoughnessTexture !== undefined ) {

					pending.push( parser.assignTexture( materialParams, 'metalnessMap', metallicRoughness.metallicRoughnessTexture ) );
					pending.push( parser.assignTexture( materialParams, 'roughnessMap', metallicRoughness.metallicRoughnessTexture ) );

				}

				materialType = this._invokeOne( function ( ext ) {

					return ext.getMaterialType && ext.getMaterialType( materialIndex );

				} );
				pending.push( Promise.all( this._invokeAll( function ( ext ) {

					return ext.extendMaterialParams && ext.extendMaterialParams( materialIndex, materialParams );

				} ) ) );

			}

			if ( materialDef.doubleSided === true ) {

				materialParams.side = THREE.DoubleSide;

			}

			const alphaMode = materialDef.alphaMode || ALPHA_MODES.OPAQUE;

			if ( alphaMode === ALPHA_MODES.BLEND ) {

				materialParams.transparent = true; // See: https://github.com/mrdoob/three.js/issues/17706

				materialParams.depthWrite = false;

			} else {

				materialParams.transparent = false;

				if ( alphaMode === ALPHA_MODES.MASK ) {

					materialParams.alphaTest = materialDef.alphaCutoff !== undefined ? materialDef.alphaCutoff : 0.5;

				}

			}

			if ( materialDef.normalTexture !== undefined && materialType !== THREE.MeshBasicMaterial ) {

				pending.push( parser.assignTexture( materialParams, 'normalMap', materialDef.normalTexture ) ); // https://github.com/mrdoob/three.js/issues/11438#issuecomment-507003995

				materialParams.normalScale = new THREE.Vector2( 1, - 1 );

				if ( materialDef.normalTexture.scale !== undefined ) {

					materialParams.normalScale.set( materialDef.normalTexture.scale, - materialDef.normalTexture.scale );

				}

			}

			if ( materialDef.occlusionTexture !== undefined && materialType !== THREE.MeshBasicMaterial ) {

				pending.push( parser.assignTexture( materialParams, 'aoMap', materialDef.occlusionTexture ) );

				if ( materialDef.occlusionTexture.strength !== undefined ) {

					materialParams.aoMapIntensity = materialDef.occlusionTexture.strength;

				}

			}

			if ( materialDef.emissiveFactor !== undefined && materialType !== THREE.MeshBasicMaterial ) {

				materialParams.emissive = new THREE.Color().fromArray( materialDef.emissiveFactor );

			}

			if ( materialDef.emissiveTexture !== undefined && materialType !== THREE.MeshBasicMaterial ) {

				pending.push( parser.assignTexture( materialParams, 'emissiveMap', materialDef.emissiveTexture ) );

			}

			return Promise.all( pending ).then( function () {

				let material;

				if ( materialType === GLTFMeshStandardSGMaterial ) {

					material = extensions[ EXTENSIONS.KHR_MATERIALS_PBR_SPECULAR_GLOSSINESS ].createMaterial( materialParams );

				} else {

					material = new materialType( materialParams );

				}

				if ( materialDef.name ) material.name = materialDef.name; // baseColorTexture, emissiveTexture, and specularGlossinessTexture use sRGB encoding.

				if ( material.map ) material.map.encoding = THREE.sRGBEncoding;
				if ( material.emissiveMap ) material.emissiveMap.encoding = THREE.sRGBEncoding;
				assignExtrasToUserData( material, materialDef );
				parser.associations.set( material, {
					type: 'materials',
					index: materialIndex
				} );
				if ( materialDef.extensions ) addUnknownExtensionsToUserData( extensions, material, materialDef );
				return material;

			} );

		}
		/** When THREE.Object3D instances are targeted by animation, they need unique names. */


		createUniqueName( originalName ) {

			const sanitizedName = THREE.PropertyBinding.sanitizeNodeName( originalName || '' );
			let name = sanitizedName;

			for ( let i = 1; this.nodeNamesUsed[ name ]; ++ i ) {

				name = sanitizedName + '_' + i;

			}

			this.nodeNamesUsed[ name ] = true;
			return name;

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#geometry
   *
   * Creates BufferGeometries from primitives.
   *
   * @param {Array<GLTF.Primitive>} primitives
   * @return {Promise<Array<BufferGeometry>>}
   */


		loadGeometries( primitives ) {

			const parser = this;
			const extensions = this.extensions;
			const cache = this.primitiveCache;

			function createDracoPrimitive( primitive ) {

				return extensions[ EXTENSIONS.KHR_DRACO_MESH_COMPRESSION ].decodePrimitive( primitive, parser ).then( function ( geometry ) {

					return addPrimitiveAttributes( geometry, primitive, parser );

				} );

			}

			const pending = [];

			for ( let i = 0, il = primitives.length; i < il; i ++ ) {

				const primitive = primitives[ i ];
				const cacheKey = createPrimitiveKey( primitive ); // See if we've already created this geometry

				const cached = cache[ cacheKey ];

				if ( cached ) {

					// Use the cached geometry if it exists
					pending.push( cached.promise );

				} else {

					let geometryPromise;

					if ( primitive.extensions && primitive.extensions[ EXTENSIONS.KHR_DRACO_MESH_COMPRESSION ] ) {

						// Use DRACO geometry if available
						geometryPromise = createDracoPrimitive( primitive );

					} else {

						// Otherwise create a new geometry
						geometryPromise = addPrimitiveAttributes( new THREE.BufferGeometry(), primitive, parser );

					} // Cache this geometry


					cache[ cacheKey ] = {
						primitive: primitive,
						promise: geometryPromise
					};
					pending.push( geometryPromise );

				}

			}

			return Promise.all( pending );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#meshes
   * @param {number} meshIndex
   * @return {Promise<Group|Mesh|SkinnedMesh>}
   */


		loadMesh( meshIndex ) {

			const parser = this;
			const json = this.json;
			const extensions = this.extensions;
			const meshDef = json.meshes[ meshIndex ];
			const primitives = meshDef.primitives;
			const pending = [];

			for ( let i = 0, il = primitives.length; i < il; i ++ ) {

				const material = primitives[ i ].material === undefined ? createDefaultMaterial( this.cache ) : this.getDependency( 'material', primitives[ i ].material );
				pending.push( material );

			}

			pending.push( parser.loadGeometries( primitives ) );
			return Promise.all( pending ).then( function ( results ) {

				const materials = results.slice( 0, results.length - 1 );
				const geometries = results[ results.length - 1 ];
				const meshes = [];

				for ( let i = 0, il = geometries.length; i < il; i ++ ) {

					const geometry = geometries[ i ];
					const primitive = primitives[ i ]; // 1. create THREE.Mesh

					let mesh;
					const material = materials[ i ];

					if ( primitive.mode === WEBGL_CONSTANTS.TRIANGLES || primitive.mode === WEBGL_CONSTANTS.TRIANGLE_STRIP || primitive.mode === WEBGL_CONSTANTS.TRIANGLE_FAN || primitive.mode === undefined ) {

						// .isSkinnedMesh isn't in glTF spec. See ._markDefs()
						mesh = meshDef.isSkinnedMesh === true ? new THREE.SkinnedMesh( geometry, material ) : new THREE.Mesh( geometry, material );

						if ( mesh.isSkinnedMesh === true && ! mesh.geometry.attributes.skinWeight.normalized ) {

							// we normalize floating point skin weight array to fix malformed assets (see #15319)
							// it's important to skip this for non-float32 data since normalizeSkinWeights assumes non-normalized inputs
							mesh.normalizeSkinWeights();

						}

						if ( primitive.mode === WEBGL_CONSTANTS.TRIANGLE_STRIP ) {

							mesh.geometry = toTrianglesDrawMode( mesh.geometry, THREE.TriangleStripDrawMode );

						} else if ( primitive.mode === WEBGL_CONSTANTS.TRIANGLE_FAN ) {

							mesh.geometry = toTrianglesDrawMode( mesh.geometry, THREE.TriangleFanDrawMode );

						}

					} else if ( primitive.mode === WEBGL_CONSTANTS.LINES ) {

						mesh = new THREE.LineSegments( geometry, material );

					} else if ( primitive.mode === WEBGL_CONSTANTS.LINE_STRIP ) {

						mesh = new THREE.Line( geometry, material );

					} else if ( primitive.mode === WEBGL_CONSTANTS.LINE_LOOP ) {

						mesh = new THREE.LineLoop( geometry, material );

					} else if ( primitive.mode === WEBGL_CONSTANTS.POINTS ) {

						mesh = new THREE.Points( geometry, material );

					} else {

						throw new Error( 'THREE.GLTFLoader: Primitive mode unsupported: ' + primitive.mode );

					}

					if ( Object.keys( mesh.geometry.morphAttributes ).length > 0 ) {

						updateMorphTargets( mesh, meshDef );

					}

					mesh.name = parser.createUniqueName( meshDef.name || 'mesh_' + meshIndex );
					assignExtrasToUserData( mesh, meshDef );
					if ( primitive.extensions ) addUnknownExtensionsToUserData( extensions, mesh, primitive );
					parser.assignFinalMaterial( mesh );
					meshes.push( mesh );

				}

				if ( meshes.length === 1 ) {

					return meshes[ 0 ];

				}

				const group = new THREE.Group();

				for ( let i = 0, il = meshes.length; i < il; i ++ ) {

					group.add( meshes[ i ] );

				}

				return group;

			} );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#cameras
   * @param {number} cameraIndex
   * @return {Promise<THREE.Camera>}
   */


		loadCamera( cameraIndex ) {

			let camera;
			const cameraDef = this.json.cameras[ cameraIndex ];
			const params = cameraDef[ cameraDef.type ];

			if ( ! params ) {

				console.warn( 'THREE.GLTFLoader: Missing camera parameters.' );
				return;

			}

			if ( cameraDef.type === 'perspective' ) {

				camera = new THREE.PerspectiveCamera( THREE.MathUtils.radToDeg( params.yfov ), params.aspectRatio || 1, params.znear || 1, params.zfar || 2e6 );

			} else if ( cameraDef.type === 'orthographic' ) {

				camera = new THREE.OrthographicCamera( - params.xmag, params.xmag, params.ymag, - params.ymag, params.znear, params.zfar );

			}

			if ( cameraDef.name ) camera.name = this.createUniqueName( cameraDef.name );
			assignExtrasToUserData( camera, cameraDef );
			return Promise.resolve( camera );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#skins
   * @param {number} skinIndex
   * @return {Promise<Object>}
   */


		loadSkin( skinIndex ) {

			const skinDef = this.json.skins[ skinIndex ];
			const skinEntry = {
				joints: skinDef.joints
			};

			if ( skinDef.inverseBindMatrices === undefined ) {

				return Promise.resolve( skinEntry );

			}

			return this.getDependency( 'accessor', skinDef.inverseBindMatrices ).then( function ( accessor ) {

				skinEntry.inverseBindMatrices = accessor;
				return skinEntry;

			} );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#animations
   * @param {number} animationIndex
   * @return {Promise<AnimationClip>}
   */


		loadAnimation( animationIndex ) {

			const json = this.json;
			const animationDef = json.animations[ animationIndex ];
			const pendingNodes = [];
			const pendingInputAccessors = [];
			const pendingOutputAccessors = [];
			const pendingSamplers = [];
			const pendingTargets = [];

			for ( let i = 0, il = animationDef.channels.length; i < il; i ++ ) {

				const channel = animationDef.channels[ i ];
				const sampler = animationDef.samplers[ channel.sampler ];
				const target = channel.target;
				const name = target.node !== undefined ? target.node : target.id; // NOTE: target.id is deprecated.

				const input = animationDef.parameters !== undefined ? animationDef.parameters[ sampler.input ] : sampler.input;
				const output = animationDef.parameters !== undefined ? animationDef.parameters[ sampler.output ] : sampler.output;
				pendingNodes.push( this.getDependency( 'node', name ) );
				pendingInputAccessors.push( this.getDependency( 'accessor', input ) );
				pendingOutputAccessors.push( this.getDependency( 'accessor', output ) );
				pendingSamplers.push( sampler );
				pendingTargets.push( target );

			}

			return Promise.all( [ Promise.all( pendingNodes ), Promise.all( pendingInputAccessors ), Promise.all( pendingOutputAccessors ), Promise.all( pendingSamplers ), Promise.all( pendingTargets ) ] ).then( function ( dependencies ) {

				const nodes = dependencies[ 0 ];
				const inputAccessors = dependencies[ 1 ];
				const outputAccessors = dependencies[ 2 ];
				const samplers = dependencies[ 3 ];
				const targets = dependencies[ 4 ];
				const tracks = [];

				for ( let i = 0, il = nodes.length; i < il; i ++ ) {

					const node = nodes[ i ];
					const inputAccessor = inputAccessors[ i ];
					const outputAccessor = outputAccessors[ i ];
					const sampler = samplers[ i ];
					const target = targets[ i ];
					if ( node === undefined ) continue;
					node.updateMatrix();
					node.matrixAutoUpdate = true;
					let TypedKeyframeTrack;

					switch ( PATH_PROPERTIES[ target.path ] ) {

						case PATH_PROPERTIES.weights:
							TypedKeyframeTrack = THREE.NumberKeyframeTrack;
							break;

						case PATH_PROPERTIES.rotation:
							TypedKeyframeTrack = THREE.QuaternionKeyframeTrack;
							break;

						case PATH_PROPERTIES.position:
						case PATH_PROPERTIES.scale:
						default:
							TypedKeyframeTrack = THREE.VectorKeyframeTrack;
							break;

					}

					const targetName = node.name ? node.name : node.uuid;
					const interpolation = sampler.interpolation !== undefined ? INTERPOLATION[ sampler.interpolation ] : THREE.InterpolateLinear;
					const targetNames = [];

					if ( PATH_PROPERTIES[ target.path ] === PATH_PROPERTIES.weights ) {

						// Node may be a THREE.Group (glTF mesh with several primitives) or a THREE.Mesh.
						node.traverse( function ( object ) {

							if ( object.isMesh === true && object.morphTargetInfluences ) {

								targetNames.push( object.name ? object.name : object.uuid );

							}

						} );

					} else {

						targetNames.push( targetName );

					}

					let outputArray = outputAccessor.array;

					if ( outputAccessor.normalized ) {

						const scale = getNormalizedComponentScale( outputArray.constructor );
						const scaled = new Float32Array( outputArray.length );

						for ( let j = 0, jl = outputArray.length; j < jl; j ++ ) {

							scaled[ j ] = outputArray[ j ] * scale;

						}

						outputArray = scaled;

					}

					for ( let j = 0, jl = targetNames.length; j < jl; j ++ ) {

						const track = new TypedKeyframeTrack( targetNames[ j ] + '.' + PATH_PROPERTIES[ target.path ], inputAccessor.array, outputArray, interpolation ); // Override interpolation with custom factory method.

						if ( sampler.interpolation === 'CUBICSPLINE' ) {

							track.createInterpolant = function InterpolantFactoryMethodGLTFCubicSpline( result ) {

								// A CUBICSPLINE keyframe in glTF has three output values for each input value,
								// representing inTangent, splineVertex, and outTangent. As a result, track.getValueSize()
								// must be divided by three to get the interpolant's sampleSize argument.
								return new GLTFCubicSplineInterpolant( this.times, this.values, this.getValueSize() / 3, result );

							}; // Mark as CUBICSPLINE. `track.getInterpolation()` doesn't support custom interpolants.


							track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline = true;

						}

						tracks.push( track );

					}

				}

				const name = animationDef.name ? animationDef.name : 'animation_' + animationIndex;
				return new THREE.AnimationClip( name, undefined, tracks );

			} );

		}

		createNodeMesh( nodeIndex ) {

			const json = this.json;
			const parser = this;
			const nodeDef = json.nodes[ nodeIndex ];
			if ( nodeDef.mesh === undefined ) return null;
			return parser.getDependency( 'mesh', nodeDef.mesh ).then( function ( mesh ) {

				const node = parser._getNodeRef( parser.meshCache, nodeDef.mesh, mesh ); // if weights are provided on the node, override weights on the mesh.


				if ( nodeDef.weights !== undefined ) {

					node.traverse( function ( o ) {

						if ( ! o.isMesh ) return;

						for ( let i = 0, il = nodeDef.weights.length; i < il; i ++ ) {

							o.morphTargetInfluences[ i ] = nodeDef.weights[ i ];

						}

					} );

				}

				return node;

			} );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#nodes-and-hierarchy
   * @param {number} nodeIndex
   * @return {Promise<Object3D>}
   */


		loadNode( nodeIndex ) {

			const json = this.json;
			const extensions = this.extensions;
			const parser = this;
			const nodeDef = json.nodes[ nodeIndex ]; // reserve node's name before its dependencies, so the root has the intended name.

			const nodeName = nodeDef.name ? parser.createUniqueName( nodeDef.name ) : '';
			return function () {

				const pending = [];

				const meshPromise = parser._invokeOne( function ( ext ) {

					return ext.createNodeMesh && ext.createNodeMesh( nodeIndex );

				} );

				if ( meshPromise ) {

					pending.push( meshPromise );

				}

				if ( nodeDef.camera !== undefined ) {

					pending.push( parser.getDependency( 'camera', nodeDef.camera ).then( function ( camera ) {

						return parser._getNodeRef( parser.cameraCache, nodeDef.camera, camera );

					} ) );

				}

				parser._invokeAll( function ( ext ) {

					return ext.createNodeAttachment && ext.createNodeAttachment( nodeIndex );

				} ).forEach( function ( promise ) {

					pending.push( promise );

				} );

				return Promise.all( pending );

			}().then( function ( objects ) {

				let node; // .isBone isn't in glTF spec. See ._markDefs

				if ( nodeDef.isBone === true ) {

					node = new THREE.Bone();

				} else if ( objects.length > 1 ) {

					node = new THREE.Group();

				} else if ( objects.length === 1 ) {

					node = objects[ 0 ];

				} else {

					node = new THREE.Object3D();

				}

				if ( node !== objects[ 0 ] ) {

					for ( let i = 0, il = objects.length; i < il; i ++ ) {

						node.add( objects[ i ] );

					}

				}

				if ( nodeDef.name ) {

					node.userData.name = nodeDef.name;
					node.name = nodeName;

				}

				assignExtrasToUserData( node, nodeDef );
				if ( nodeDef.extensions ) addUnknownExtensionsToUserData( extensions, node, nodeDef );

				if ( nodeDef.matrix !== undefined ) {

					const matrix = new THREE.Matrix4();
					matrix.fromArray( nodeDef.matrix );
					node.applyMatrix4( matrix );

				} else {

					if ( nodeDef.translation !== undefined ) {

						node.position.fromArray( nodeDef.translation );

					}

					if ( nodeDef.rotation !== undefined ) {

						node.quaternion.fromArray( nodeDef.rotation );

					}

					if ( nodeDef.scale !== undefined ) {

						node.scale.fromArray( nodeDef.scale );

					}

				}

				parser.associations.set( node, {
					type: 'nodes',
					index: nodeIndex
				} );
				return node;

			} );

		}
		/**
   * Specification: https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#scenes
   * @param {number} sceneIndex
   * @return {Promise<Group>}
   */


		loadScene( sceneIndex ) {

			const json = this.json;
			const extensions = this.extensions;
			const sceneDef = this.json.scenes[ sceneIndex ];
			const parser = this; // THREE.Loader returns THREE.Group, not Scene.
			// See: https://github.com/mrdoob/three.js/issues/18342#issuecomment-578981172

			const scene = new THREE.Group();
			if ( sceneDef.name ) scene.name = parser.createUniqueName( sceneDef.name );
			assignExtrasToUserData( scene, sceneDef );
			if ( sceneDef.extensions ) addUnknownExtensionsToUserData( extensions, scene, sceneDef );
			const nodeIds = sceneDef.nodes || [];
			const pending = [];

			for ( let i = 0, il = nodeIds.length; i < il; i ++ ) {

				pending.push( buildNodeHierachy( nodeIds[ i ], scene, json, parser ) );

			}

			return Promise.all( pending ).then( function () {

				return scene;

			} );

		}

	}

	function buildNodeHierachy( nodeId, parentObject, json, parser ) {

		const nodeDef = json.nodes[ nodeId ];
		return parser.getDependency( 'node', nodeId ).then( function ( node ) {

			if ( nodeDef.skin === undefined ) return node; // build skeleton here as well

			let skinEntry;
			return parser.getDependency( 'skin', nodeDef.skin ).then( function ( skin ) {

				skinEntry = skin;
				const pendingJoints = [];

				for ( let i = 0, il = skinEntry.joints.length; i < il; i ++ ) {

					pendingJoints.push( parser.getDependency( 'node', skinEntry.joints[ i ] ) );

				}

				return Promise.all( pendingJoints );

			} ).then( function ( jointNodes ) {

				node.traverse( function ( mesh ) {

					if ( ! mesh.isMesh ) return;
					const bones = [];
					const boneInverses = [];

					for ( let j = 0, jl = jointNodes.length; j < jl; j ++ ) {

						const jointNode = jointNodes[ j ];

						if ( jointNode ) {

							bones.push( jointNode );
							const mat = new THREE.Matrix4();

							if ( skinEntry.inverseBindMatrices !== undefined ) {

								mat.fromArray( skinEntry.inverseBindMatrices.array, j * 16 );

							}

							boneInverses.push( mat );

						} else {

							console.warn( 'THREE.GLTFLoader: Joint "%s" could not be found.', skinEntry.joints[ j ] );

						}

					}

					mesh.bind( new THREE.Skeleton( bones, boneInverses ), mesh.matrixWorld );

				} );
				return node;

			} );

		} ).then( function ( node ) {

			// build node hierachy
			parentObject.add( node );
			const pending = [];

			if ( nodeDef.children ) {

				const children = nodeDef.children;

				for ( let i = 0, il = children.length; i < il; i ++ ) {

					const child = children[ i ];
					pending.push( buildNodeHierachy( child, node, json, parser ) );

				}

			}

			return Promise.all( pending );

		} );

	}
	/**
 * @param {BufferGeometry} geometry
 * @param {GLTF.Primitive} primitiveDef
 * @param {GLTFParser} parser
 */


	function computeBounds( geometry, primitiveDef, parser ) {

		const attributes = primitiveDef.attributes;
		const box = new THREE.Box3();

		if ( attributes.POSITION !== undefined ) {

			const accessor = parser.json.accessors[ attributes.POSITION ];
			const min = accessor.min;
			const max = accessor.max; // glTF requires 'min' and 'max', but VRM (which extends glTF) currently ignores that requirement.

			if ( min !== undefined && max !== undefined ) {

				box.set( new THREE.Vector3( min[ 0 ], min[ 1 ], min[ 2 ] ), new THREE.Vector3( max[ 0 ], max[ 1 ], max[ 2 ] ) );

				if ( accessor.normalized ) {

					const boxScale = getNormalizedComponentScale( WEBGL_COMPONENT_TYPES[ accessor.componentType ] );
					box.min.multiplyScalar( boxScale );
					box.max.multiplyScalar( boxScale );

				}

			} else {

				console.warn( 'THREE.GLTFLoader: Missing min/max properties for accessor POSITION.' );
				return;

			}

		} else {

			return;

		}

		const targets = primitiveDef.targets;

		if ( targets !== undefined ) {

			const maxDisplacement = new THREE.Vector3();
			const vector = new THREE.Vector3();

			for ( let i = 0, il = targets.length; i < il; i ++ ) {

				const target = targets[ i ];

				if ( target.POSITION !== undefined ) {

					const accessor = parser.json.accessors[ target.POSITION ];
					const min = accessor.min;
					const max = accessor.max; // glTF requires 'min' and 'max', but VRM (which extends glTF) currently ignores that requirement.

					if ( min !== undefined && max !== undefined ) {

						// we need to get max of absolute components because target weight is [-1,1]
						vector.setX( Math.max( Math.abs( min[ 0 ] ), Math.abs( max[ 0 ] ) ) );
						vector.setY( Math.max( Math.abs( min[ 1 ] ), Math.abs( max[ 1 ] ) ) );
						vector.setZ( Math.max( Math.abs( min[ 2 ] ), Math.abs( max[ 2 ] ) ) );

						if ( accessor.normalized ) {

							const boxScale = getNormalizedComponentScale( WEBGL_COMPONENT_TYPES[ accessor.componentType ] );
							vector.multiplyScalar( boxScale );

						} // Note: this assumes that the sum of all weights is at most 1. This isn't quite correct - it's more conservative
						// to assume that each target can have a max weight of 1. However, for some use cases - notably, when morph targets
						// are used to implement key-frame animations and as such only two are active at a time - this results in very large
						// boxes. So for now we make a box that's sometimes a touch too small but is hopefully mostly of reasonable size.


						maxDisplacement.max( vector );

					} else {

						console.warn( 'THREE.GLTFLoader: Missing min/max properties for accessor POSITION.' );

					}

				}

			} // As per comment above this box isn't conservative, but has a reasonable size for a very large number of morph targets.


			box.expandByVector( maxDisplacement );

		}

		geometry.boundingBox = box;
		const sphere = new THREE.Sphere();
		box.getCenter( sphere.center );
		sphere.radius = box.min.distanceTo( box.max ) / 2;
		geometry.boundingSphere = sphere;

	}
	/**
 * @param {BufferGeometry} geometry
 * @param {GLTF.Primitive} primitiveDef
 * @param {GLTFParser} parser
 * @return {Promise<BufferGeometry>}
 */


	function addPrimitiveAttributes( geometry, primitiveDef, parser ) {

		const attributes = primitiveDef.attributes;
		const pending = [];

		function assignAttributeAccessor( accessorIndex, attributeName ) {

			return parser.getDependency( 'accessor', accessorIndex ).then( function ( accessor ) {

				geometry.setAttribute( attributeName, accessor );

			} );

		}

		for ( const gltfAttributeName in attributes ) {

			const threeAttributeName = ATTRIBUTES[ gltfAttributeName ] || gltfAttributeName.toLowerCase(); // Skip attributes already provided by e.g. Draco extension.

			if ( threeAttributeName in geometry.attributes ) continue;
			pending.push( assignAttributeAccessor( attributes[ gltfAttributeName ], threeAttributeName ) );

		}

		if ( primitiveDef.indices !== undefined && ! geometry.index ) {

			const accessor = parser.getDependency( 'accessor', primitiveDef.indices ).then( function ( accessor ) {

				geometry.setIndex( accessor );

			} );
			pending.push( accessor );

		}

		assignExtrasToUserData( geometry, primitiveDef );
		computeBounds( geometry, primitiveDef, parser );
		return Promise.all( pending ).then( function () {

			return primitiveDef.targets !== undefined ? addMorphTargets( geometry, primitiveDef.targets, parser ) : geometry;

		} );

	}
	/**
 * @param {BufferGeometry} geometry
 * @param {Number} drawMode
 * @return {BufferGeometry}
 */


	function toTrianglesDrawMode( geometry, drawMode ) {

		let index = geometry.getIndex(); // generate index if not present

		if ( index === null ) {

			const indices = [];
			const position = geometry.getAttribute( 'position' );

			if ( position !== undefined ) {

				for ( let i = 0; i < position.count; i ++ ) {

					indices.push( i );

				}

				geometry.setIndex( indices );
				index = geometry.getIndex();

			} else {

				console.error( 'THREE.GLTFLoader.toTrianglesDrawMode(): Undefined position attribute. Processing not possible.' );
				return geometry;

			}

		} //


		const numberOfTriangles = index.count - 2;
		const newIndices = [];

		if ( drawMode === THREE.TriangleFanDrawMode ) {

			// gl.TRIANGLE_FAN
			for ( let i = 1; i <= numberOfTriangles; i ++ ) {

				newIndices.push( index.getX( 0 ) );
				newIndices.push( index.getX( i ) );
				newIndices.push( index.getX( i + 1 ) );

			}

		} else {

			// gl.TRIANGLE_STRIP
			for ( let i = 0; i < numberOfTriangles; i ++ ) {

				if ( i % 2 === 0 ) {

					newIndices.push( index.getX( i ) );
					newIndices.push( index.getX( i + 1 ) );
					newIndices.push( index.getX( i + 2 ) );

				} else {

					newIndices.push( index.getX( i + 2 ) );
					newIndices.push( index.getX( i + 1 ) );
					newIndices.push( index.getX( i ) );

				}

			}

		}

		if ( newIndices.length / 3 !== numberOfTriangles ) {

			console.error( 'THREE.GLTFLoader.toTrianglesDrawMode(): Unable to generate correct amount of triangles.' );

		} // build final geometry


		const newGeometry = geometry.clone();
		newGeometry.setIndex( newIndices );
		return newGeometry;

	}

	THREE.GLTFLoader = GLTFLoader;

} )();

( function () {

	class ColladaLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const path = scope.path === '' ? THREE.LoaderUtils.extractUrlBase( url ) : scope.path;
			const loader = new THREE.FileLoader( scope.manager );
			loader.setPath( scope.path );
			loader.setRequestHeader( scope.requestHeader );
			loader.setWithCredentials( scope.withCredentials );
			loader.load( url, function ( text ) {

				try {

					onLoad( scope.parse( text, path ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		parse( text, path ) {

			function getElementsByTagName( xml, name ) {

				// Non recursive xml.getElementsByTagName() ...
				const array = [];
				const childNodes = xml.childNodes;

				for ( let i = 0, l = childNodes.length; i < l; i ++ ) {

					const child = childNodes[ i ];

					if ( child.nodeName === name ) {

						array.push( child );

					}

				}

				return array;

			}

			function parseStrings( text ) {

				if ( text.length === 0 ) return [];
				const parts = text.trim().split( /\s+/ );
				const array = new Array( parts.length );

				for ( let i = 0, l = parts.length; i < l; i ++ ) {

					array[ i ] = parts[ i ];

				}

				return array;

			}

			function parseFloats( text ) {

				if ( text.length === 0 ) return [];
				const parts = text.trim().split( /\s+/ );
				const array = new Array( parts.length );

				for ( let i = 0, l = parts.length; i < l; i ++ ) {

					array[ i ] = parseFloat( parts[ i ] );

				}

				return array;

			}

			function parseInts( text ) {

				if ( text.length === 0 ) return [];
				const parts = text.trim().split( /\s+/ );
				const array = new Array( parts.length );

				for ( let i = 0, l = parts.length; i < l; i ++ ) {

					array[ i ] = parseInt( parts[ i ] );

				}

				return array;

			}

			function parseId( text ) {

				return text.substring( 1 );

			}

			function generateId() {

				return 'three_default_' + count ++;

			}

			function isEmpty( object ) {

				return Object.keys( object ).length === 0;

			} // asset


			function parseAsset( xml ) {

				return {
					unit: parseAssetUnit( getElementsByTagName( xml, 'unit' )[ 0 ] ),
					upAxis: parseAssetUpAxis( getElementsByTagName( xml, 'up_axis' )[ 0 ] )
				};

			}

			function parseAssetUnit( xml ) {

				if ( xml !== undefined && xml.hasAttribute( 'meter' ) === true ) {

					return parseFloat( xml.getAttribute( 'meter' ) );

				} else {

					return 1; // default 1 meter

				}

			}

			function parseAssetUpAxis( xml ) {

				return xml !== undefined ? xml.textContent : 'Y_UP';

			} // library


			function parseLibrary( xml, libraryName, nodeName, parser ) {

				const library = getElementsByTagName( xml, libraryName )[ 0 ];

				if ( library !== undefined ) {

					const elements = getElementsByTagName( library, nodeName );

					for ( let i = 0; i < elements.length; i ++ ) {

						parser( elements[ i ] );

					}

				}

			}

			function buildLibrary( data, builder ) {

				for ( const name in data ) {

					const object = data[ name ];
					object.build = builder( data[ name ] );

				}

			} // get


			function getBuild( data, builder ) {

				if ( data.build !== undefined ) return data.build;
				data.build = builder( data );
				return data.build;

			} // animation


			function parseAnimation( xml ) {

				const data = {
					sources: {},
					samplers: {},
					channels: {}
				};
				let hasChildren = false;

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;
					let id;

					switch ( child.nodeName ) {

						case 'source':
							id = child.getAttribute( 'id' );
							data.sources[ id ] = parseSource( child );
							break;

						case 'sampler':
							id = child.getAttribute( 'id' );
							data.samplers[ id ] = parseAnimationSampler( child );
							break;

						case 'channel':
							id = child.getAttribute( 'target' );
							data.channels[ id ] = parseAnimationChannel( child );
							break;

						case 'animation':
							// hierarchy of related animations
							parseAnimation( child );
							hasChildren = true;
							break;

						default:
							console.log( child );

					}

				}

				if ( hasChildren === false ) {

					// since 'id' attributes can be optional, it's necessary to generate a UUID for unqiue assignment
					library.animations[ xml.getAttribute( 'id' ) || THREE.MathUtils.generateUUID() ] = data;

				}

			}

			function parseAnimationSampler( xml ) {

				const data = {
					inputs: {}
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'input':
							const id = parseId( child.getAttribute( 'source' ) );
							const semantic = child.getAttribute( 'semantic' );
							data.inputs[ semantic ] = id;
							break;

					}

				}

				return data;

			}

			function parseAnimationChannel( xml ) {

				const data = {};
				const target = xml.getAttribute( 'target' ); // parsing SID Addressing Syntax

				let parts = target.split( '/' );
				const id = parts.shift();
				let sid = parts.shift(); // check selection syntax

				const arraySyntax = sid.indexOf( '(' ) !== - 1;
				const memberSyntax = sid.indexOf( '.' ) !== - 1;

				if ( memberSyntax ) {

					//  member selection access
					parts = sid.split( '.' );
					sid = parts.shift();
					data.member = parts.shift();

				} else if ( arraySyntax ) {

					// array-access syntax. can be used to express fields in one-dimensional vectors or two-dimensional matrices.
					const indices = sid.split( '(' );
					sid = indices.shift();

					for ( let i = 0; i < indices.length; i ++ ) {

						indices[ i ] = parseInt( indices[ i ].replace( /\)/, '' ) );

					}

					data.indices = indices;

				}

				data.id = id;
				data.sid = sid;
				data.arraySyntax = arraySyntax;
				data.memberSyntax = memberSyntax;
				data.sampler = parseId( xml.getAttribute( 'source' ) );
				return data;

			}

			function buildAnimation( data ) {

				const tracks = [];
				const channels = data.channels;
				const samplers = data.samplers;
				const sources = data.sources;

				for ( const target in channels ) {

					if ( channels.hasOwnProperty( target ) ) {

						const channel = channels[ target ];
						const sampler = samplers[ channel.sampler ];
						const inputId = sampler.inputs.INPUT;
						const outputId = sampler.inputs.OUTPUT;
						const inputSource = sources[ inputId ];
						const outputSource = sources[ outputId ];
						const animation = buildAnimationChannel( channel, inputSource, outputSource );
						createKeyframeTracks( animation, tracks );

					}

				}

				return tracks;

			}

			function getAnimation( id ) {

				return getBuild( library.animations[ id ], buildAnimation );

			}

			function buildAnimationChannel( channel, inputSource, outputSource ) {

				const node = library.nodes[ channel.id ];
				const object3D = getNode( node.id );
				const transform = node.transforms[ channel.sid ];
				const defaultMatrix = node.matrix.clone().transpose();
				let time, stride;
				let i, il, j, jl;
				const data = {}; // the collada spec allows the animation of data in various ways.
				// depending on the transform type (matrix, translate, rotate, scale), we execute different logic

				switch ( transform ) {

					case 'matrix':
						for ( i = 0, il = inputSource.array.length; i < il; i ++ ) {

							time = inputSource.array[ i ];
							stride = i * outputSource.stride;
							if ( data[ time ] === undefined ) data[ time ] = {};

							if ( channel.arraySyntax === true ) {

								const value = outputSource.array[ stride ];
								const index = channel.indices[ 0 ] + 4 * channel.indices[ 1 ];
								data[ time ][ index ] = value;

							} else {

								for ( j = 0, jl = outputSource.stride; j < jl; j ++ ) {

									data[ time ][ j ] = outputSource.array[ stride + j ];

								}

							}

						}

						break;

					case 'translate':
						console.warn( 'THREE.ColladaLoader: Animation transform type "%s" not yet implemented.', transform );
						break;

					case 'rotate':
						console.warn( 'THREE.ColladaLoader: Animation transform type "%s" not yet implemented.', transform );
						break;

					case 'scale':
						console.warn( 'THREE.ColladaLoader: Animation transform type "%s" not yet implemented.', transform );
						break;

				}

				const keyframes = prepareAnimationData( data, defaultMatrix );
				const animation = {
					name: object3D.uuid,
					keyframes: keyframes
				};
				return animation;

			}

			function prepareAnimationData( data, defaultMatrix ) {

				const keyframes = []; // transfer data into a sortable array

				for ( const time in data ) {

					keyframes.push( {
						time: parseFloat( time ),
						value: data[ time ]
					} );

				} // ensure keyframes are sorted by time


				keyframes.sort( ascending ); // now we clean up all animation data, so we can use them for keyframe tracks

				for ( let i = 0; i < 16; i ++ ) {

					transformAnimationData( keyframes, i, defaultMatrix.elements[ i ] );

				}

				return keyframes; // array sort function

				function ascending( a, b ) {

					return a.time - b.time;

				}

			}

			const position = new THREE.Vector3();
			const scale = new THREE.Vector3();
			const quaternion = new THREE.Quaternion();

			function createKeyframeTracks( animation, tracks ) {

				const keyframes = animation.keyframes;
				const name = animation.name;
				const times = [];
				const positionData = [];
				const quaternionData = [];
				const scaleData = [];

				for ( let i = 0, l = keyframes.length; i < l; i ++ ) {

					const keyframe = keyframes[ i ];
					const time = keyframe.time;
					const value = keyframe.value;
					matrix.fromArray( value ).transpose();
					matrix.decompose( position, quaternion, scale );
					times.push( time );
					positionData.push( position.x, position.y, position.z );
					quaternionData.push( quaternion.x, quaternion.y, quaternion.z, quaternion.w );
					scaleData.push( scale.x, scale.y, scale.z );

				}

				if ( positionData.length > 0 ) tracks.push( new THREE.VectorKeyframeTrack( name + '.position', times, positionData ) );
				if ( quaternionData.length > 0 ) tracks.push( new THREE.QuaternionKeyframeTrack( name + '.quaternion', times, quaternionData ) );
				if ( scaleData.length > 0 ) tracks.push( new THREE.VectorKeyframeTrack( name + '.scale', times, scaleData ) );
				return tracks;

			}

			function transformAnimationData( keyframes, property, defaultValue ) {

				let keyframe;
				let empty = true;
				let i, l; // check, if values of a property are missing in our keyframes

				for ( i = 0, l = keyframes.length; i < l; i ++ ) {

					keyframe = keyframes[ i ];

					if ( keyframe.value[ property ] === undefined ) {

						keyframe.value[ property ] = null; // mark as missing

					} else {

						empty = false;

					}

				}

				if ( empty === true ) {

					// no values at all, so we set a default value
					for ( i = 0, l = keyframes.length; i < l; i ++ ) {

						keyframe = keyframes[ i ];
						keyframe.value[ property ] = defaultValue;

					}

				} else {

					// filling gaps
					createMissingKeyframes( keyframes, property );

				}

			}

			function createMissingKeyframes( keyframes, property ) {

				let prev, next;

				for ( let i = 0, l = keyframes.length; i < l; i ++ ) {

					const keyframe = keyframes[ i ];

					if ( keyframe.value[ property ] === null ) {

						prev = getPrev( keyframes, i, property );
						next = getNext( keyframes, i, property );

						if ( prev === null ) {

							keyframe.value[ property ] = next.value[ property ];
							continue;

						}

						if ( next === null ) {

							keyframe.value[ property ] = prev.value[ property ];
							continue;

						}

						interpolate( keyframe, prev, next, property );

					}

				}

			}

			function getPrev( keyframes, i, property ) {

				while ( i >= 0 ) {

					const keyframe = keyframes[ i ];
					if ( keyframe.value[ property ] !== null ) return keyframe;
					i --;

				}

				return null;

			}

			function getNext( keyframes, i, property ) {

				while ( i < keyframes.length ) {

					const keyframe = keyframes[ i ];
					if ( keyframe.value[ property ] !== null ) return keyframe;
					i ++;

				}

				return null;

			}

			function interpolate( key, prev, next, property ) {

				if ( next.time - prev.time === 0 ) {

					key.value[ property ] = prev.value[ property ];
					return;

				}

				key.value[ property ] = ( key.time - prev.time ) * ( next.value[ property ] - prev.value[ property ] ) / ( next.time - prev.time ) + prev.value[ property ];

			} // animation clips


			function parseAnimationClip( xml ) {

				const data = {
					name: xml.getAttribute( 'id' ) || 'default',
					start: parseFloat( xml.getAttribute( 'start' ) || 0 ),
					end: parseFloat( xml.getAttribute( 'end' ) || 0 ),
					animations: []
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'instance_animation':
							data.animations.push( parseId( child.getAttribute( 'url' ) ) );
							break;

					}

				}

				library.clips[ xml.getAttribute( 'id' ) ] = data;

			}

			function buildAnimationClip( data ) {

				const tracks = [];
				const name = data.name;
				const duration = data.end - data.start || - 1;
				const animations = data.animations;

				for ( let i = 0, il = animations.length; i < il; i ++ ) {

					const animationTracks = getAnimation( animations[ i ] );

					for ( let j = 0, jl = animationTracks.length; j < jl; j ++ ) {

						tracks.push( animationTracks[ j ] );

					}

				}

				return new THREE.AnimationClip( name, duration, tracks );

			}

			function getAnimationClip( id ) {

				return getBuild( library.clips[ id ], buildAnimationClip );

			} // controller


			function parseController( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'skin':
							// there is exactly one skin per controller
							data.id = parseId( child.getAttribute( 'source' ) );
							data.skin = parseSkin( child );
							break;

						case 'morph':
							data.id = parseId( child.getAttribute( 'source' ) );
							console.warn( 'THREE.ColladaLoader: Morph target animation not supported yet.' );
							break;

					}

				}

				library.controllers[ xml.getAttribute( 'id' ) ] = data;

			}

			function parseSkin( xml ) {

				const data = {
					sources: {}
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'bind_shape_matrix':
							data.bindShapeMatrix = parseFloats( child.textContent );
							break;

						case 'source':
							const id = child.getAttribute( 'id' );
							data.sources[ id ] = parseSource( child );
							break;

						case 'joints':
							data.joints = parseJoints( child );
							break;

						case 'vertex_weights':
							data.vertexWeights = parseVertexWeights( child );
							break;

					}

				}

				return data;

			}

			function parseJoints( xml ) {

				const data = {
					inputs: {}
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'input':
							const semantic = child.getAttribute( 'semantic' );
							const id = parseId( child.getAttribute( 'source' ) );
							data.inputs[ semantic ] = id;
							break;

					}

				}

				return data;

			}

			function parseVertexWeights( xml ) {

				const data = {
					inputs: {}
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'input':
							const semantic = child.getAttribute( 'semantic' );
							const id = parseId( child.getAttribute( 'source' ) );
							const offset = parseInt( child.getAttribute( 'offset' ) );
							data.inputs[ semantic ] = {
								id: id,
								offset: offset
							};
							break;

						case 'vcount':
							data.vcount = parseInts( child.textContent );
							break;

						case 'v':
							data.v = parseInts( child.textContent );
							break;

					}

				}

				return data;

			}

			function buildController( data ) {

				const build = {
					id: data.id
				};
				const geometry = library.geometries[ build.id ];

				if ( data.skin !== undefined ) {

					build.skin = buildSkin( data.skin ); // we enhance the 'sources' property of the corresponding geometry with our skin data

					geometry.sources.skinIndices = build.skin.indices;
					geometry.sources.skinWeights = build.skin.weights;

				}

				return build;

			}

			function buildSkin( data ) {

				const BONE_LIMIT = 4;
				const build = {
					joints: [],
					// this must be an array to preserve the joint order
					indices: {
						array: [],
						stride: BONE_LIMIT
					},
					weights: {
						array: [],
						stride: BONE_LIMIT
					}
				};
				const sources = data.sources;
				const vertexWeights = data.vertexWeights;
				const vcount = vertexWeights.vcount;
				const v = vertexWeights.v;
				const jointOffset = vertexWeights.inputs.JOINT.offset;
				const weightOffset = vertexWeights.inputs.WEIGHT.offset;
				const jointSource = data.sources[ data.joints.inputs.JOINT ];
				const inverseSource = data.sources[ data.joints.inputs.INV_BIND_MATRIX ];
				const weights = sources[ vertexWeights.inputs.WEIGHT.id ].array;
				let stride = 0;
				let i, j, l; // procces skin data for each vertex

				for ( i = 0, l = vcount.length; i < l; i ++ ) {

					const jointCount = vcount[ i ]; // this is the amount of joints that affect a single vertex

					const vertexSkinData = [];

					for ( j = 0; j < jointCount; j ++ ) {

						const skinIndex = v[ stride + jointOffset ];
						const weightId = v[ stride + weightOffset ];
						const skinWeight = weights[ weightId ];
						vertexSkinData.push( {
							index: skinIndex,
							weight: skinWeight
						} );
						stride += 2;

					} // we sort the joints in descending order based on the weights.
					// this ensures, we only procced the most important joints of the vertex


					vertexSkinData.sort( descending ); // now we provide for each vertex a set of four index and weight values.
					// the order of the skin data matches the order of vertices

					for ( j = 0; j < BONE_LIMIT; j ++ ) {

						const d = vertexSkinData[ j ];

						if ( d !== undefined ) {

							build.indices.array.push( d.index );
							build.weights.array.push( d.weight );

						} else {

							build.indices.array.push( 0 );
							build.weights.array.push( 0 );

						}

					}

				} // setup bind matrix


				if ( data.bindShapeMatrix ) {

					build.bindMatrix = new THREE.Matrix4().fromArray( data.bindShapeMatrix ).transpose();

				} else {

					build.bindMatrix = new THREE.Matrix4().identity();

				} // process bones and inverse bind matrix data


				for ( i = 0, l = jointSource.array.length; i < l; i ++ ) {

					const name = jointSource.array[ i ];
					const boneInverse = new THREE.Matrix4().fromArray( inverseSource.array, i * inverseSource.stride ).transpose();
					build.joints.push( {
						name: name,
						boneInverse: boneInverse
					} );

				}

				return build; // array sort function

				function descending( a, b ) {

					return b.weight - a.weight;

				}

			}

			function getController( id ) {

				return getBuild( library.controllers[ id ], buildController );

			} // image


			function parseImage( xml ) {

				const data = {
					init_from: getElementsByTagName( xml, 'init_from' )[ 0 ].textContent
				};
				library.images[ xml.getAttribute( 'id' ) ] = data;

			}

			function buildImage( data ) {

				if ( data.build !== undefined ) return data.build;
				return data.init_from;

			}

			function getImage( id ) {

				const data = library.images[ id ];

				if ( data !== undefined ) {

					return getBuild( data, buildImage );

				}

				console.warn( 'THREE.ColladaLoader: Couldn\'t find image with ID:', id );
				return null;

			} // effect


			function parseEffect( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'profile_COMMON':
							data.profile = parseEffectProfileCOMMON( child );
							break;

					}

				}

				library.effects[ xml.getAttribute( 'id' ) ] = data;

			}

			function parseEffectProfileCOMMON( xml ) {

				const data = {
					surfaces: {},
					samplers: {}
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'newparam':
							parseEffectNewparam( child, data );
							break;

						case 'technique':
							data.technique = parseEffectTechnique( child );
							break;

						case 'extra':
							data.extra = parseEffectExtra( child );
							break;

					}

				}

				return data;

			}

			function parseEffectNewparam( xml, data ) {

				const sid = xml.getAttribute( 'sid' );

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'surface':
							data.surfaces[ sid ] = parseEffectSurface( child );
							break;

						case 'sampler2D':
							data.samplers[ sid ] = parseEffectSampler( child );
							break;

					}

				}

			}

			function parseEffectSurface( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'init_from':
							data.init_from = child.textContent;
							break;

					}

				}

				return data;

			}

			function parseEffectSampler( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'source':
							data.source = child.textContent;
							break;

					}

				}

				return data;

			}

			function parseEffectTechnique( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'constant':
						case 'lambert':
						case 'blinn':
						case 'phong':
							data.type = child.nodeName;
							data.parameters = parseEffectParameters( child );
							break;

					}

				}

				return data;

			}

			function parseEffectParameters( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'emission':
						case 'diffuse':
						case 'specular':
						case 'bump':
						case 'ambient':
						case 'shininess':
						case 'transparency':
							data[ child.nodeName ] = parseEffectParameter( child );
							break;

						case 'transparent':
							data[ child.nodeName ] = {
								opaque: child.getAttribute( 'opaque' ),
								data: parseEffectParameter( child )
							};
							break;

					}

				}

				return data;

			}

			function parseEffectParameter( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'color':
							data[ child.nodeName ] = parseFloats( child.textContent );
							break;

						case 'float':
							data[ child.nodeName ] = parseFloat( child.textContent );
							break;

						case 'texture':
							data[ child.nodeName ] = {
								id: child.getAttribute( 'texture' ),
								extra: parseEffectParameterTexture( child )
							};
							break;

					}

				}

				return data;

			}

			function parseEffectParameterTexture( xml ) {

				const data = {
					technique: {}
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'extra':
							parseEffectParameterTextureExtra( child, data );
							break;

					}

				}

				return data;

			}

			function parseEffectParameterTextureExtra( xml, data ) {

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'technique':
							parseEffectParameterTextureExtraTechnique( child, data );
							break;

					}

				}

			}

			function parseEffectParameterTextureExtraTechnique( xml, data ) {

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'repeatU':
						case 'repeatV':
						case 'offsetU':
						case 'offsetV':
							data.technique[ child.nodeName ] = parseFloat( child.textContent );
							break;

						case 'wrapU':
						case 'wrapV':
							// some files have values for wrapU/wrapV which become NaN via parseInt
							if ( child.textContent.toUpperCase() === 'TRUE' ) {

								data.technique[ child.nodeName ] = 1;

							} else if ( child.textContent.toUpperCase() === 'FALSE' ) {

								data.technique[ child.nodeName ] = 0;

							} else {

								data.technique[ child.nodeName ] = parseInt( child.textContent );

							}

							break;

					}

				}

			}

			function parseEffectExtra( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'technique':
							data.technique = parseEffectExtraTechnique( child );
							break;

					}

				}

				return data;

			}

			function parseEffectExtraTechnique( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'double_sided':
							data[ child.nodeName ] = parseInt( child.textContent );
							break;

					}

				}

				return data;

			}

			function buildEffect( data ) {

				return data;

			}

			function getEffect( id ) {

				return getBuild( library.effects[ id ], buildEffect );

			} // material


			function parseMaterial( xml ) {

				const data = {
					name: xml.getAttribute( 'name' )
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'instance_effect':
							data.url = parseId( child.getAttribute( 'url' ) );
							break;

					}

				}

				library.materials[ xml.getAttribute( 'id' ) ] = data;

			}

			function getTextureLoader( image ) {

				let loader;
				let extension = image.slice( ( image.lastIndexOf( '.' ) - 1 >>> 0 ) + 2 ); // http://www.jstips.co/en/javascript/get-file-extension/

				extension = extension.toLowerCase();

				switch ( extension ) {

					case 'tga':
						loader = tgaLoader;
						break;

					default:
						loader = textureLoader;

				}

				return loader;

			}

			function buildMaterial( data ) {

				const effect = getEffect( data.url );
				const technique = effect.profile.technique;
				const extra = effect.profile.extra;
				let material;

				switch ( technique.type ) {

					case 'phong':
					case 'blinn':
						material = new THREE.MeshPhongMaterial();
						break;

					case 'lambert':
						material = new THREE.MeshLambertMaterial();
						break;

					default:
						material = new THREE.MeshBasicMaterial();
						break;

				}

				material.name = data.name || '';

				function getTexture( textureObject ) {

					const sampler = effect.profile.samplers[ textureObject.id ];
					let image = null; // get image

					if ( sampler !== undefined ) {

						const surface = effect.profile.surfaces[ sampler.source ];
						image = getImage( surface.init_from );

					} else {

						console.warn( 'THREE.ColladaLoader: Undefined sampler. Access image directly (see #12530).' );
						image = getImage( textureObject.id );

					} // create texture if image is avaiable


					if ( image !== null ) {

						const loader = getTextureLoader( image );

						if ( loader !== undefined ) {

							const texture = loader.load( image );
							const extra = textureObject.extra;

							if ( extra !== undefined && extra.technique !== undefined && isEmpty( extra.technique ) === false ) {

								const technique = extra.technique;
								texture.wrapS = technique.wrapU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
								texture.wrapT = technique.wrapV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
								texture.offset.set( technique.offsetU || 0, technique.offsetV || 0 );
								texture.repeat.set( technique.repeatU || 1, technique.repeatV || 1 );

							} else {

								texture.wrapS = THREE.RepeatWrapping;
								texture.wrapT = THREE.RepeatWrapping;

							}

							return texture;

						} else {

							console.warn( 'THREE.ColladaLoader: THREE.Loader for texture %s not found.', image );
							return null;

						}

					} else {

						console.warn( 'THREE.ColladaLoader: Couldn\'t create texture with ID:', textureObject.id );
						return null;

					}

				}

				const parameters = technique.parameters;

				for ( const key in parameters ) {

					const parameter = parameters[ key ];

					switch ( key ) {

						case 'diffuse':
							if ( parameter.color ) material.color.fromArray( parameter.color );
							if ( parameter.texture ) material.map = getTexture( parameter.texture );
							break;

						case 'specular':
							if ( parameter.color && material.specular ) material.specular.fromArray( parameter.color );
							if ( parameter.texture ) material.specularMap = getTexture( parameter.texture );
							break;

						case 'bump':
							if ( parameter.texture ) material.normalMap = getTexture( parameter.texture );
							break;

						case 'ambient':
							if ( parameter.texture ) material.lightMap = getTexture( parameter.texture );
							break;

						case 'shininess':
							if ( parameter.float && material.shininess ) material.shininess = parameter.float;
							break;

						case 'emission':
							if ( parameter.color && material.emissive ) material.emissive.fromArray( parameter.color );
							if ( parameter.texture ) material.emissiveMap = getTexture( parameter.texture );
							break;

					}

				} //


				let transparent = parameters[ 'transparent' ];
				let transparency = parameters[ 'transparency' ]; // <transparency> does not exist but <transparent>

				if ( transparency === undefined && transparent ) {

					transparency = {
						float: 1
					};

				} // <transparent> does not exist but <transparency>


				if ( transparent === undefined && transparency ) {

					transparent = {
						opaque: 'A_ONE',
						data: {
							color: [ 1, 1, 1, 1 ]
						}
					};

				}

				if ( transparent && transparency ) {

					// handle case if a texture exists but no color
					if ( transparent.data.texture ) {

						// we do not set an alpha map (see #13792)
						material.transparent = true;

					} else {

						const color = transparent.data.color;

						switch ( transparent.opaque ) {

							case 'A_ONE':
								material.opacity = color[ 3 ] * transparency.float;
								break;

							case 'RGB_ZERO':
								material.opacity = 1 - color[ 0 ] * transparency.float;
								break;

							case 'A_ZERO':
								material.opacity = 1 - color[ 3 ] * transparency.float;
								break;

							case 'RGB_ONE':
								material.opacity = color[ 0 ] * transparency.float;
								break;

							default:
								console.warn( 'THREE.ColladaLoader: Invalid opaque type "%s" of transparent tag.', transparent.opaque );

						}

						if ( material.opacity < 1 ) material.transparent = true;

					}

				} //


				if ( extra !== undefined && extra.technique !== undefined && extra.technique.double_sided === 1 ) {

					material.side = THREE.DoubleSide;

				}

				return material;

			}

			function getMaterial( id ) {

				return getBuild( library.materials[ id ], buildMaterial );

			} // camera


			function parseCamera( xml ) {

				const data = {
					name: xml.getAttribute( 'name' )
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'optics':
							data.optics = parseCameraOptics( child );
							break;

					}

				}

				library.cameras[ xml.getAttribute( 'id' ) ] = data;

			}

			function parseCameraOptics( xml ) {

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];

					switch ( child.nodeName ) {

						case 'technique_common':
							return parseCameraTechnique( child );

					}

				}

				return {};

			}

			function parseCameraTechnique( xml ) {

				const data = {};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];

					switch ( child.nodeName ) {

						case 'perspective':
						case 'orthographic':
							data.technique = child.nodeName;
							data.parameters = parseCameraParameters( child );
							break;

					}

				}

				return data;

			}

			function parseCameraParameters( xml ) {

				const data = {};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];

					switch ( child.nodeName ) {

						case 'xfov':
						case 'yfov':
						case 'xmag':
						case 'ymag':
						case 'znear':
						case 'zfar':
						case 'aspect_ratio':
							data[ child.nodeName ] = parseFloat( child.textContent );
							break;

					}

				}

				return data;

			}

			function buildCamera( data ) {

				let camera;

				switch ( data.optics.technique ) {

					case 'perspective':
						camera = new THREE.PerspectiveCamera( data.optics.parameters.yfov, data.optics.parameters.aspect_ratio, data.optics.parameters.znear, data.optics.parameters.zfar );
						break;

					case 'orthographic':
						let ymag = data.optics.parameters.ymag;
						let xmag = data.optics.parameters.xmag;
						const aspectRatio = data.optics.parameters.aspect_ratio;
						xmag = xmag === undefined ? ymag * aspectRatio : xmag;
						ymag = ymag === undefined ? xmag / aspectRatio : ymag;
						xmag *= 0.5;
						ymag *= 0.5;
						camera = new THREE.OrthographicCamera( - xmag, xmag, ymag, - ymag, // left, right, top, bottom
							data.optics.parameters.znear, data.optics.parameters.zfar );
						break;

					default:
						camera = new THREE.PerspectiveCamera();
						break;

				}

				camera.name = data.name || '';
				return camera;

			}

			function getCamera( id ) {

				const data = library.cameras[ id ];

				if ( data !== undefined ) {

					return getBuild( data, buildCamera );

				}

				console.warn( 'THREE.ColladaLoader: Couldn\'t find camera with ID:', id );
				return null;

			} // light


			function parseLight( xml ) {

				let data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'technique_common':
							data = parseLightTechnique( child );
							break;

					}

				}

				library.lights[ xml.getAttribute( 'id' ) ] = data;

			}

			function parseLightTechnique( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'directional':
						case 'point':
						case 'spot':
						case 'ambient':
							data.technique = child.nodeName;
							data.parameters = parseLightParameters( child );

					}

				}

				return data;

			}

			function parseLightParameters( xml ) {

				const data = {};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'color':
							const array = parseFloats( child.textContent );
							data.color = new THREE.Color().fromArray( array );
							break;

						case 'falloff_angle':
							data.falloffAngle = parseFloat( child.textContent );
							break;

						case 'quadratic_attenuation':
							const f = parseFloat( child.textContent );
							data.distance = f ? Math.sqrt( 1 / f ) : 0;
							break;

					}

				}

				return data;

			}

			function buildLight( data ) {

				let light;

				switch ( data.technique ) {

					case 'directional':
						light = new THREE.DirectionalLight();
						break;

					case 'point':
						light = new THREE.PointLight();
						break;

					case 'spot':
						light = new THREE.SpotLight();
						break;

					case 'ambient':
						light = new THREE.AmbientLight();
						break;

				}

				if ( data.parameters.color ) light.color.copy( data.parameters.color );
				if ( data.parameters.distance ) light.distance = data.parameters.distance;
				return light;

			}

			function getLight( id ) {

				const data = library.lights[ id ];

				if ( data !== undefined ) {

					return getBuild( data, buildLight );

				}

				console.warn( 'THREE.ColladaLoader: Couldn\'t find light with ID:', id );
				return null;

			} // geometry


			function parseGeometry( xml ) {

				const data = {
					name: xml.getAttribute( 'name' ),
					sources: {},
					vertices: {},
					primitives: []
				};
				const mesh = getElementsByTagName( xml, 'mesh' )[ 0 ]; // the following tags inside geometry are not supported yet (see https://github.com/mrdoob/three.js/pull/12606): convex_mesh, spline, brep

				if ( mesh === undefined ) return;

				for ( let i = 0; i < mesh.childNodes.length; i ++ ) {

					const child = mesh.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;
					const id = child.getAttribute( 'id' );

					switch ( child.nodeName ) {

						case 'source':
							data.sources[ id ] = parseSource( child );
							break;

						case 'vertices':
							// data.sources[ id ] = data.sources[ parseId( getElementsByTagName( child, 'input' )[ 0 ].getAttribute( 'source' ) ) ];
							data.vertices = parseGeometryVertices( child );
							break;

						case 'polygons':
							console.warn( 'THREE.ColladaLoader: Unsupported primitive type: ', child.nodeName );
							break;

						case 'lines':
						case 'linestrips':
						case 'polylist':
						case 'triangles':
							data.primitives.push( parseGeometryPrimitive( child ) );
							break;

						default:
							console.log( child );

					}

				}

				library.geometries[ xml.getAttribute( 'id' ) ] = data;

			}

			function parseSource( xml ) {

				const data = {
					array: [],
					stride: 3
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'float_array':
							data.array = parseFloats( child.textContent );
							break;

						case 'Name_array':
							data.array = parseStrings( child.textContent );
							break;

						case 'technique_common':
							const accessor = getElementsByTagName( child, 'accessor' )[ 0 ];

							if ( accessor !== undefined ) {

								data.stride = parseInt( accessor.getAttribute( 'stride' ) );

							}

							break;

					}

				}

				return data;

			}

			function parseGeometryVertices( xml ) {

				const data = {};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;
					data[ child.getAttribute( 'semantic' ) ] = parseId( child.getAttribute( 'source' ) );

				}

				return data;

			}

			function parseGeometryPrimitive( xml ) {

				const primitive = {
					type: xml.nodeName,
					material: xml.getAttribute( 'material' ),
					count: parseInt( xml.getAttribute( 'count' ) ),
					inputs: {},
					stride: 0,
					hasUV: false
				};

				for ( let i = 0, l = xml.childNodes.length; i < l; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'input':
							const id = parseId( child.getAttribute( 'source' ) );
							const semantic = child.getAttribute( 'semantic' );
							const offset = parseInt( child.getAttribute( 'offset' ) );
							const set = parseInt( child.getAttribute( 'set' ) );
							const inputname = set > 0 ? semantic + set : semantic;
							primitive.inputs[ inputname ] = {
								id: id,
								offset: offset
							};
							primitive.stride = Math.max( primitive.stride, offset + 1 );
							if ( semantic === 'TEXCOORD' ) primitive.hasUV = true;
							break;

						case 'vcount':
							primitive.vcount = parseInts( child.textContent );
							break;

						case 'p':
							primitive.p = parseInts( child.textContent );
							break;

					}

				}

				return primitive;

			}

			function groupPrimitives( primitives ) {

				const build = {};

				for ( let i = 0; i < primitives.length; i ++ ) {

					const primitive = primitives[ i ];
					if ( build[ primitive.type ] === undefined ) build[ primitive.type ] = [];
					build[ primitive.type ].push( primitive );

				}

				return build;

			}

			function checkUVCoordinates( primitives ) {

				let count = 0;

				for ( let i = 0, l = primitives.length; i < l; i ++ ) {

					const primitive = primitives[ i ];

					if ( primitive.hasUV === true ) {

						count ++;

					}

				}

				if ( count > 0 && count < primitives.length ) {

					primitives.uvsNeedsFix = true;

				}

			}

			function buildGeometry( data ) {

				const build = {};
				const sources = data.sources;
				const vertices = data.vertices;
				const primitives = data.primitives;
				if ( primitives.length === 0 ) return {}; // our goal is to create one buffer geometry for a single type of primitives
				// first, we group all primitives by their type

				const groupedPrimitives = groupPrimitives( primitives );

				for ( const type in groupedPrimitives ) {

					const primitiveType = groupedPrimitives[ type ]; // second, ensure consistent uv coordinates for each type of primitives (polylist,triangles or lines)

					checkUVCoordinates( primitiveType ); // third, create a buffer geometry for each type of primitives

					build[ type ] = buildGeometryType( primitiveType, sources, vertices );

				}

				return build;

			}

			function buildGeometryType( primitives, sources, vertices ) {

				const build = {};
				const position = {
					array: [],
					stride: 0
				};
				const normal = {
					array: [],
					stride: 0
				};
				const uv = {
					array: [],
					stride: 0
				};
				const uv2 = {
					array: [],
					stride: 0
				};
				const color = {
					array: [],
					stride: 0
				};
				const skinIndex = {
					array: [],
					stride: 4
				};
				const skinWeight = {
					array: [],
					stride: 4
				};
				const geometry = new THREE.BufferGeometry();
				const materialKeys = [];
				let start = 0;

				for ( let p = 0; p < primitives.length; p ++ ) {

					const primitive = primitives[ p ];
					const inputs = primitive.inputs; // groups

					let count = 0;

					switch ( primitive.type ) {

						case 'lines':
						case 'linestrips':
							count = primitive.count * 2;
							break;

						case 'triangles':
							count = primitive.count * 3;
							break;

						case 'polylist':
							for ( let g = 0; g < primitive.count; g ++ ) {

								const vc = primitive.vcount[ g ];

								switch ( vc ) {

									case 3:
										count += 3; // single triangle

										break;

									case 4:
										count += 6; // quad, subdivided into two triangles

										break;

									default:
										count += ( vc - 2 ) * 3; // polylist with more than four vertices

										break;

								}

							}

							break;

						default:
							console.warn( 'THREE.ColladaLoader: Unknow primitive type:', primitive.type );

					}

					geometry.addGroup( start, count, p );
					start += count; // material

					if ( primitive.material ) {

						materialKeys.push( primitive.material );

					} // geometry data


					for ( const name in inputs ) {

						const input = inputs[ name ];

						switch ( name ) {

							case 'VERTEX':
								for ( const key in vertices ) {

									const id = vertices[ key ];

									switch ( key ) {

										case 'POSITION':
											const prevLength = position.array.length;
											buildGeometryData( primitive, sources[ id ], input.offset, position.array );
											position.stride = sources[ id ].stride;

											if ( sources.skinWeights && sources.skinIndices ) {

												buildGeometryData( primitive, sources.skinIndices, input.offset, skinIndex.array );
												buildGeometryData( primitive, sources.skinWeights, input.offset, skinWeight.array );

											} // see #3803


											if ( primitive.hasUV === false && primitives.uvsNeedsFix === true ) {

												const count = ( position.array.length - prevLength ) / position.stride;

												for ( let i = 0; i < count; i ++ ) {

													// fill missing uv coordinates
													uv.array.push( 0, 0 );

												}

											}

											break;

										case 'NORMAL':
											buildGeometryData( primitive, sources[ id ], input.offset, normal.array );
											normal.stride = sources[ id ].stride;
											break;

										case 'COLOR':
											buildGeometryData( primitive, sources[ id ], input.offset, color.array );
											color.stride = sources[ id ].stride;
											break;

										case 'TEXCOORD':
											buildGeometryData( primitive, sources[ id ], input.offset, uv.array );
											uv.stride = sources[ id ].stride;
											break;

										case 'TEXCOORD1':
											buildGeometryData( primitive, sources[ id ], input.offset, uv2.array );
											uv.stride = sources[ id ].stride;
											break;

										default:
											console.warn( 'THREE.ColladaLoader: Semantic "%s" not handled in geometry build process.', key );

									}

								}

								break;

							case 'NORMAL':
								buildGeometryData( primitive, sources[ input.id ], input.offset, normal.array );
								normal.stride = sources[ input.id ].stride;
								break;

							case 'COLOR':
								buildGeometryData( primitive, sources[ input.id ], input.offset, color.array );
								color.stride = sources[ input.id ].stride;
								break;

							case 'TEXCOORD':
								buildGeometryData( primitive, sources[ input.id ], input.offset, uv.array );
								uv.stride = sources[ input.id ].stride;
								break;

							case 'TEXCOORD1':
								buildGeometryData( primitive, sources[ input.id ], input.offset, uv2.array );
								uv2.stride = sources[ input.id ].stride;
								break;

						}

					}

				} // build geometry


				if ( position.array.length > 0 ) geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( position.array, position.stride ) );
				if ( normal.array.length > 0 ) geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normal.array, normal.stride ) );
				if ( color.array.length > 0 ) geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( color.array, color.stride ) );
				if ( uv.array.length > 0 ) geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv.array, uv.stride ) );
				if ( uv2.array.length > 0 ) geometry.setAttribute( 'uv2', new THREE.Float32BufferAttribute( uv2.array, uv2.stride ) );
				if ( skinIndex.array.length > 0 ) geometry.setAttribute( 'skinIndex', new THREE.Float32BufferAttribute( skinIndex.array, skinIndex.stride ) );
				if ( skinWeight.array.length > 0 ) geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( skinWeight.array, skinWeight.stride ) );
				build.data = geometry;
				build.type = primitives[ 0 ].type;
				build.materialKeys = materialKeys;
				return build;

			}

			function buildGeometryData( primitive, source, offset, array ) {

				const indices = primitive.p;
				const stride = primitive.stride;
				const vcount = primitive.vcount;

				function pushVector( i ) {

					let index = indices[ i + offset ] * sourceStride;
					const length = index + sourceStride;

					for ( ; index < length; index ++ ) {

						array.push( sourceArray[ index ] );

					}

				}

				const sourceArray = source.array;
				const sourceStride = source.stride;

				if ( primitive.vcount !== undefined ) {

					let index = 0;

					for ( let i = 0, l = vcount.length; i < l; i ++ ) {

						const count = vcount[ i ];

						if ( count === 4 ) {

							const a = index + stride * 0;
							const b = index + stride * 1;
							const c = index + stride * 2;
							const d = index + stride * 3;
							pushVector( a );
							pushVector( b );
							pushVector( d );
							pushVector( b );
							pushVector( c );
							pushVector( d );

						} else if ( count === 3 ) {

							const a = index + stride * 0;
							const b = index + stride * 1;
							const c = index + stride * 2;
							pushVector( a );
							pushVector( b );
							pushVector( c );

						} else if ( count > 4 ) {

							for ( let k = 1, kl = count - 2; k <= kl; k ++ ) {

								const a = index + stride * 0;
								const b = index + stride * k;
								const c = index + stride * ( k + 1 );
								pushVector( a );
								pushVector( b );
								pushVector( c );

							}

						}

						index += stride * count;

					}

				} else {

					for ( let i = 0, l = indices.length; i < l; i += stride ) {

						pushVector( i );

					}

				}

			}

			function getGeometry( id ) {

				return getBuild( library.geometries[ id ], buildGeometry );

			} // kinematics


			function parseKinematicsModel( xml ) {

				const data = {
					name: xml.getAttribute( 'name' ) || '',
					joints: {},
					links: []
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'technique_common':
							parseKinematicsTechniqueCommon( child, data );
							break;

					}

				}

				library.kinematicsModels[ xml.getAttribute( 'id' ) ] = data;

			}

			function buildKinematicsModel( data ) {

				if ( data.build !== undefined ) return data.build;
				return data;

			}

			function getKinematicsModel( id ) {

				return getBuild( library.kinematicsModels[ id ], buildKinematicsModel );

			}

			function parseKinematicsTechniqueCommon( xml, data ) {

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'joint':
							data.joints[ child.getAttribute( 'sid' ) ] = parseKinematicsJoint( child );
							break;

						case 'link':
							data.links.push( parseKinematicsLink( child ) );
							break;

					}

				}

			}

			function parseKinematicsJoint( xml ) {

				let data;

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'prismatic':
						case 'revolute':
							data = parseKinematicsJointParameter( child );
							break;

					}

				}

				return data;

			}

			function parseKinematicsJointParameter( xml ) {

				const data = {
					sid: xml.getAttribute( 'sid' ),
					name: xml.getAttribute( 'name' ) || '',
					axis: new THREE.Vector3(),
					limits: {
						min: 0,
						max: 0
					},
					type: xml.nodeName,
					static: false,
					zeroPosition: 0,
					middlePosition: 0
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'axis':
							const array = parseFloats( child.textContent );
							data.axis.fromArray( array );
							break;

						case 'limits':
							const max = child.getElementsByTagName( 'max' )[ 0 ];
							const min = child.getElementsByTagName( 'min' )[ 0 ];
							data.limits.max = parseFloat( max.textContent );
							data.limits.min = parseFloat( min.textContent );
							break;

					}

				} // if min is equal to or greater than max, consider the joint static


				if ( data.limits.min >= data.limits.max ) {

					data.static = true;

				} // calculate middle position


				data.middlePosition = ( data.limits.min + data.limits.max ) / 2.0;
				return data;

			}

			function parseKinematicsLink( xml ) {

				const data = {
					sid: xml.getAttribute( 'sid' ),
					name: xml.getAttribute( 'name' ) || '',
					attachments: [],
					transforms: []
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'attachment_full':
							data.attachments.push( parseKinematicsAttachment( child ) );
							break;

						case 'matrix':
						case 'translate':
						case 'rotate':
							data.transforms.push( parseKinematicsTransform( child ) );
							break;

					}

				}

				return data;

			}

			function parseKinematicsAttachment( xml ) {

				const data = {
					joint: xml.getAttribute( 'joint' ).split( '/' ).pop(),
					transforms: [],
					links: []
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'link':
							data.links.push( parseKinematicsLink( child ) );
							break;

						case 'matrix':
						case 'translate':
						case 'rotate':
							data.transforms.push( parseKinematicsTransform( child ) );
							break;

					}

				}

				return data;

			}

			function parseKinematicsTransform( xml ) {

				const data = {
					type: xml.nodeName
				};
				const array = parseFloats( xml.textContent );

				switch ( data.type ) {

					case 'matrix':
						data.obj = new THREE.Matrix4();
						data.obj.fromArray( array ).transpose();
						break;

					case 'translate':
						data.obj = new THREE.Vector3();
						data.obj.fromArray( array );
						break;

					case 'rotate':
						data.obj = new THREE.Vector3();
						data.obj.fromArray( array );
						data.angle = THREE.MathUtils.degToRad( array[ 3 ] );
						break;

				}

				return data;

			} // physics


			function parsePhysicsModel( xml ) {

				const data = {
					name: xml.getAttribute( 'name' ) || '',
					rigidBodies: {}
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'rigid_body':
							data.rigidBodies[ child.getAttribute( 'name' ) ] = {};
							parsePhysicsRigidBody( child, data.rigidBodies[ child.getAttribute( 'name' ) ] );
							break;

					}

				}

				library.physicsModels[ xml.getAttribute( 'id' ) ] = data;

			}

			function parsePhysicsRigidBody( xml, data ) {

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'technique_common':
							parsePhysicsTechniqueCommon( child, data );
							break;

					}

				}

			}

			function parsePhysicsTechniqueCommon( xml, data ) {

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'inertia':
							data.inertia = parseFloats( child.textContent );
							break;

						case 'mass':
							data.mass = parseFloats( child.textContent )[ 0 ];
							break;

					}

				}

			} // scene


			function parseKinematicsScene( xml ) {

				const data = {
					bindJointAxis: []
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'bind_joint_axis':
							data.bindJointAxis.push( parseKinematicsBindJointAxis( child ) );
							break;

					}

				}

				library.kinematicsScenes[ parseId( xml.getAttribute( 'url' ) ) ] = data;

			}

			function parseKinematicsBindJointAxis( xml ) {

				const data = {
					target: xml.getAttribute( 'target' ).split( '/' ).pop()
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;

					switch ( child.nodeName ) {

						case 'axis':
							const param = child.getElementsByTagName( 'param' )[ 0 ];
							data.axis = param.textContent;
							const tmpJointIndex = data.axis.split( 'inst_' ).pop().split( 'axis' )[ 0 ];
							data.jointIndex = tmpJointIndex.substr( 0, tmpJointIndex.length - 1 );
							break;

					}

				}

				return data;

			}

			function buildKinematicsScene( data ) {

				if ( data.build !== undefined ) return data.build;
				return data;

			}

			function getKinematicsScene( id ) {

				return getBuild( library.kinematicsScenes[ id ], buildKinematicsScene );

			}

			function setupKinematics() {

				const kinematicsModelId = Object.keys( library.kinematicsModels )[ 0 ];
				const kinematicsSceneId = Object.keys( library.kinematicsScenes )[ 0 ];
				const visualSceneId = Object.keys( library.visualScenes )[ 0 ];
				if ( kinematicsModelId === undefined || kinematicsSceneId === undefined ) return;
				const kinematicsModel = getKinematicsModel( kinematicsModelId );
				const kinematicsScene = getKinematicsScene( kinematicsSceneId );
				const visualScene = getVisualScene( visualSceneId );
				const bindJointAxis = kinematicsScene.bindJointAxis;
				const jointMap = {};

				for ( let i = 0, l = bindJointAxis.length; i < l; i ++ ) {

					const axis = bindJointAxis[ i ]; // the result of the following query is an element of type 'translate', 'rotate','scale' or 'matrix'

					const targetElement = collada.querySelector( '[sid="' + axis.target + '"]' );

					if ( targetElement ) {

						// get the parent of the transform element
						const parentVisualElement = targetElement.parentElement; // connect the joint of the kinematics model with the element in the visual scene

						connect( axis.jointIndex, parentVisualElement );

					}

				}

				function connect( jointIndex, visualElement ) {

					const visualElementName = visualElement.getAttribute( 'name' );
					const joint = kinematicsModel.joints[ jointIndex ];
					visualScene.traverse( function ( object ) {

						if ( object.name === visualElementName ) {

							jointMap[ jointIndex ] = {
								object: object,
								transforms: buildTransformList( visualElement ),
								joint: joint,
								position: joint.zeroPosition
							};

						}

					} );

				}

				const m0 = new THREE.Matrix4();
				kinematics = {
					joints: kinematicsModel && kinematicsModel.joints,
					getJointValue: function ( jointIndex ) {

						const jointData = jointMap[ jointIndex ];

						if ( jointData ) {

							return jointData.position;

						} else {

							console.warn( 'THREE.ColladaLoader: Joint ' + jointIndex + ' doesn\'t exist.' );

						}

					},
					setJointValue: function ( jointIndex, value ) {

						const jointData = jointMap[ jointIndex ];

						if ( jointData ) {

							const joint = jointData.joint;

							if ( value > joint.limits.max || value < joint.limits.min ) {

								console.warn( 'THREE.ColladaLoader: Joint ' + jointIndex + ' value ' + value + ' outside of limits (min: ' + joint.limits.min + ', max: ' + joint.limits.max + ').' );

							} else if ( joint.static ) {

								console.warn( 'THREE.ColladaLoader: Joint ' + jointIndex + ' is static.' );

							} else {

								const object = jointData.object;
								const axis = joint.axis;
								const transforms = jointData.transforms;
								matrix.identity(); // each update, we have to apply all transforms in the correct order

								for ( let i = 0; i < transforms.length; i ++ ) {

									const transform = transforms[ i ]; // if there is a connection of the transform node with a joint, apply the joint value

									if ( transform.sid && transform.sid.indexOf( jointIndex ) !== - 1 ) {

										switch ( joint.type ) {

											case 'revolute':
												matrix.multiply( m0.makeRotationAxis( axis, THREE.MathUtils.degToRad( value ) ) );
												break;

											case 'prismatic':
												matrix.multiply( m0.makeTranslation( axis.x * value, axis.y * value, axis.z * value ) );
												break;

											default:
												console.warn( 'THREE.ColladaLoader: Unknown joint type: ' + joint.type );
												break;

										}

									} else {

										switch ( transform.type ) {

											case 'matrix':
												matrix.multiply( transform.obj );
												break;

											case 'translate':
												matrix.multiply( m0.makeTranslation( transform.obj.x, transform.obj.y, transform.obj.z ) );
												break;

											case 'scale':
												matrix.scale( transform.obj );
												break;

											case 'rotate':
												matrix.multiply( m0.makeRotationAxis( transform.obj, transform.angle ) );
												break;

										}

									}

								}

								object.matrix.copy( matrix );
								object.matrix.decompose( object.position, object.quaternion, object.scale );
								jointMap[ jointIndex ].position = value;

							}

						} else {

							console.log( 'THREE.ColladaLoader: ' + jointIndex + ' does not exist.' );

						}

					}
				};

			}

			function buildTransformList( node ) {

				const transforms = [];
				const xml = collada.querySelector( '[id="' + node.id + '"]' );

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;
					let array, vector;

					switch ( child.nodeName ) {

						case 'matrix':
							array = parseFloats( child.textContent );
							const matrix = new THREE.Matrix4().fromArray( array ).transpose();
							transforms.push( {
								sid: child.getAttribute( 'sid' ),
								type: child.nodeName,
								obj: matrix
							} );
							break;

						case 'translate':
						case 'scale':
							array = parseFloats( child.textContent );
							vector = new THREE.Vector3().fromArray( array );
							transforms.push( {
								sid: child.getAttribute( 'sid' ),
								type: child.nodeName,
								obj: vector
							} );
							break;

						case 'rotate':
							array = parseFloats( child.textContent );
							vector = new THREE.Vector3().fromArray( array );
							const angle = THREE.MathUtils.degToRad( array[ 3 ] );
							transforms.push( {
								sid: child.getAttribute( 'sid' ),
								type: child.nodeName,
								obj: vector,
								angle: angle
							} );
							break;

					}

				}

				return transforms;

			} // nodes


			function prepareNodes( xml ) {

				const elements = xml.getElementsByTagName( 'node' ); // ensure all node elements have id attributes

				for ( let i = 0; i < elements.length; i ++ ) {

					const element = elements[ i ];

					if ( element.hasAttribute( 'id' ) === false ) {

						element.setAttribute( 'id', generateId() );

					}

				}

			}

			const matrix = new THREE.Matrix4();
			const vector = new THREE.Vector3();

			function parseNode( xml ) {

				const data = {
					name: xml.getAttribute( 'name' ) || '',
					type: xml.getAttribute( 'type' ),
					id: xml.getAttribute( 'id' ),
					sid: xml.getAttribute( 'sid' ),
					matrix: new THREE.Matrix4(),
					nodes: [],
					instanceCameras: [],
					instanceControllers: [],
					instanceLights: [],
					instanceGeometries: [],
					instanceNodes: [],
					transforms: {}
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];
					if ( child.nodeType !== 1 ) continue;
					let array;

					switch ( child.nodeName ) {

						case 'node':
							data.nodes.push( child.getAttribute( 'id' ) );
							parseNode( child );
							break;

						case 'instance_camera':
							data.instanceCameras.push( parseId( child.getAttribute( 'url' ) ) );
							break;

						case 'instance_controller':
							data.instanceControllers.push( parseNodeInstance( child ) );
							break;

						case 'instance_light':
							data.instanceLights.push( parseId( child.getAttribute( 'url' ) ) );
							break;

						case 'instance_geometry':
							data.instanceGeometries.push( parseNodeInstance( child ) );
							break;

						case 'instance_node':
							data.instanceNodes.push( parseId( child.getAttribute( 'url' ) ) );
							break;

						case 'matrix':
							array = parseFloats( child.textContent );
							data.matrix.multiply( matrix.fromArray( array ).transpose() );
							data.transforms[ child.getAttribute( 'sid' ) ] = child.nodeName;
							break;

						case 'translate':
							array = parseFloats( child.textContent );
							vector.fromArray( array );
							data.matrix.multiply( matrix.makeTranslation( vector.x, vector.y, vector.z ) );
							data.transforms[ child.getAttribute( 'sid' ) ] = child.nodeName;
							break;

						case 'rotate':
							array = parseFloats( child.textContent );
							const angle = THREE.MathUtils.degToRad( array[ 3 ] );
							data.matrix.multiply( matrix.makeRotationAxis( vector.fromArray( array ), angle ) );
							data.transforms[ child.getAttribute( 'sid' ) ] = child.nodeName;
							break;

						case 'scale':
							array = parseFloats( child.textContent );
							data.matrix.scale( vector.fromArray( array ) );
							data.transforms[ child.getAttribute( 'sid' ) ] = child.nodeName;
							break;

						case 'extra':
							break;

						default:
							console.log( child );

					}

				}

				if ( hasNode( data.id ) ) {

					console.warn( 'THREE.ColladaLoader: There is already a node with ID %s. Exclude current node from further processing.', data.id );

				} else {

					library.nodes[ data.id ] = data;

				}

				return data;

			}

			function parseNodeInstance( xml ) {

				const data = {
					id: parseId( xml.getAttribute( 'url' ) ),
					materials: {},
					skeletons: []
				};

				for ( let i = 0; i < xml.childNodes.length; i ++ ) {

					const child = xml.childNodes[ i ];

					switch ( child.nodeName ) {

						case 'bind_material':
							const instances = child.getElementsByTagName( 'instance_material' );

							for ( let j = 0; j < instances.length; j ++ ) {

								const instance = instances[ j ];
								const symbol = instance.getAttribute( 'symbol' );
								const target = instance.getAttribute( 'target' );
								data.materials[ symbol ] = parseId( target );

							}

							break;

						case 'skeleton':
							data.skeletons.push( parseId( child.textContent ) );
							break;

						default:
							break;

					}

				}

				return data;

			}

			function buildSkeleton( skeletons, joints ) {

				const boneData = [];
				const sortedBoneData = [];
				let i, j, data; // a skeleton can have multiple root bones. collada expresses this
				// situtation with multiple "skeleton" tags per controller instance

				for ( i = 0; i < skeletons.length; i ++ ) {

					const skeleton = skeletons[ i ];
					let root;

					if ( hasNode( skeleton ) ) {

						root = getNode( skeleton );
						buildBoneHierarchy( root, joints, boneData );

					} else if ( hasVisualScene( skeleton ) ) {

						// handle case where the skeleton refers to the visual scene (#13335)
						const visualScene = library.visualScenes[ skeleton ];
						const children = visualScene.children;

						for ( let j = 0; j < children.length; j ++ ) {

							const child = children[ j ];

							if ( child.type === 'JOINT' ) {

								const root = getNode( child.id );
								buildBoneHierarchy( root, joints, boneData );

							}

						}

					} else {

						console.error( 'THREE.ColladaLoader: Unable to find root bone of skeleton with ID:', skeleton );

					}

				} // sort bone data (the order is defined in the corresponding controller)


				for ( i = 0; i < joints.length; i ++ ) {

					for ( j = 0; j < boneData.length; j ++ ) {

						data = boneData[ j ];

						if ( data.bone.name === joints[ i ].name ) {

							sortedBoneData[ i ] = data;
							data.processed = true;
							break;

						}

					}

				} // add unprocessed bone data at the end of the list


				for ( i = 0; i < boneData.length; i ++ ) {

					data = boneData[ i ];

					if ( data.processed === false ) {

						sortedBoneData.push( data );
						data.processed = true;

					}

				} // setup arrays for skeleton creation


				const bones = [];
				const boneInverses = [];

				for ( i = 0; i < sortedBoneData.length; i ++ ) {

					data = sortedBoneData[ i ];
					bones.push( data.bone );
					boneInverses.push( data.boneInverse );

				}

				return new THREE.Skeleton( bones, boneInverses );

			}

			function buildBoneHierarchy( root, joints, boneData ) {

				// setup bone data from visual scene
				root.traverse( function ( object ) {

					if ( object.isBone === true ) {

						let boneInverse; // retrieve the boneInverse from the controller data

						for ( let i = 0; i < joints.length; i ++ ) {

							const joint = joints[ i ];

							if ( joint.name === object.name ) {

								boneInverse = joint.boneInverse;
								break;

							}

						}

						if ( boneInverse === undefined ) {

							// Unfortunately, there can be joints in the visual scene that are not part of the
							// corresponding controller. In this case, we have to create a dummy boneInverse matrix
							// for the respective bone. This bone won't affect any vertices, because there are no skin indices
							// and weights defined for it. But we still have to add the bone to the sorted bone list in order to
							// ensure a correct animation of the model.
							boneInverse = new THREE.Matrix4();

						}

						boneData.push( {
							bone: object,
							boneInverse: boneInverse,
							processed: false
						} );

					}

				} );

			}

			function buildNode( data ) {

				const objects = [];
				const matrix = data.matrix;
				const nodes = data.nodes;
				const type = data.type;
				const instanceCameras = data.instanceCameras;
				const instanceControllers = data.instanceControllers;
				const instanceLights = data.instanceLights;
				const instanceGeometries = data.instanceGeometries;
				const instanceNodes = data.instanceNodes; // nodes

				for ( let i = 0, l = nodes.length; i < l; i ++ ) {

					objects.push( getNode( nodes[ i ] ) );

				} // instance cameras


				for ( let i = 0, l = instanceCameras.length; i < l; i ++ ) {

					const instanceCamera = getCamera( instanceCameras[ i ] );

					if ( instanceCamera !== null ) {

						objects.push( instanceCamera.clone() );

					}

				} // instance controllers


				for ( let i = 0, l = instanceControllers.length; i < l; i ++ ) {

					const instance = instanceControllers[ i ];
					const controller = getController( instance.id );
					const geometries = getGeometry( controller.id );
					const newObjects = buildObjects( geometries, instance.materials );
					const skeletons = instance.skeletons;
					const joints = controller.skin.joints;
					const skeleton = buildSkeleton( skeletons, joints );

					for ( let j = 0, jl = newObjects.length; j < jl; j ++ ) {

						const object = newObjects[ j ];

						if ( object.isSkinnedMesh ) {

							object.bind( skeleton, controller.skin.bindMatrix );
							object.normalizeSkinWeights();

						}

						objects.push( object );

					}

				} // instance lights


				for ( let i = 0, l = instanceLights.length; i < l; i ++ ) {

					const instanceLight = getLight( instanceLights[ i ] );

					if ( instanceLight !== null ) {

						objects.push( instanceLight.clone() );

					}

				} // instance geometries


				for ( let i = 0, l = instanceGeometries.length; i < l; i ++ ) {

					const instance = instanceGeometries[ i ]; // a single geometry instance in collada can lead to multiple object3Ds.
					// this is the case when primitives are combined like triangles and lines

					const geometries = getGeometry( instance.id );
					const newObjects = buildObjects( geometries, instance.materials );

					for ( let j = 0, jl = newObjects.length; j < jl; j ++ ) {

						objects.push( newObjects[ j ] );

					}

				} // instance nodes


				for ( let i = 0, l = instanceNodes.length; i < l; i ++ ) {

					objects.push( getNode( instanceNodes[ i ] ).clone() );

				}

				let object;

				if ( nodes.length === 0 && objects.length === 1 ) {

					object = objects[ 0 ];

				} else {

					object = type === 'JOINT' ? new THREE.Bone() : new THREE.Group();

					for ( let i = 0; i < objects.length; i ++ ) {

						object.add( objects[ i ] );

					}

				}

				object.name = type === 'JOINT' ? data.sid : data.name;
				object.matrix.copy( matrix );
				object.matrix.decompose( object.position, object.quaternion, object.scale );
				return object;

			}

			const fallbackMaterial = new THREE.MeshBasicMaterial( {
				color: 0xff00ff
			} );

			function resolveMaterialBinding( keys, instanceMaterials ) {

				const materials = [];

				for ( let i = 0, l = keys.length; i < l; i ++ ) {

					const id = instanceMaterials[ keys[ i ] ];

					if ( id === undefined ) {

						console.warn( 'THREE.ColladaLoader: Material with key %s not found. Apply fallback material.', keys[ i ] );
						materials.push( fallbackMaterial );

					} else {

						materials.push( getMaterial( id ) );

					}

				}

				return materials;

			}

			function buildObjects( geometries, instanceMaterials ) {

				const objects = [];

				for ( const type in geometries ) {

					const geometry = geometries[ type ];
					const materials = resolveMaterialBinding( geometry.materialKeys, instanceMaterials ); // handle case if no materials are defined

					if ( materials.length === 0 ) {

						if ( type === 'lines' || type === 'linestrips' ) {

							materials.push( new THREE.LineBasicMaterial() );

						} else {

							materials.push( new THREE.MeshPhongMaterial() );

						}

					} // regard skinning


					const skinning = geometry.data.attributes.skinIndex !== undefined; // choose between a single or multi materials (material array)

					const material = materials.length === 1 ? materials[ 0 ] : materials; // now create a specific 3D object

					let object;

					switch ( type ) {

						case 'lines':
							object = new THREE.LineSegments( geometry.data, material );
							break;

						case 'linestrips':
							object = new THREE.Line( geometry.data, material );
							break;

						case 'triangles':
						case 'polylist':
							if ( skinning ) {

								object = new THREE.SkinnedMesh( geometry.data, material );

							} else {

								object = new THREE.Mesh( geometry.data, material );

							}

							break;

					}

					objects.push( object );

				}

				return objects;

			}

			function hasNode( id ) {

				return library.nodes[ id ] !== undefined;

			}

			function getNode( id ) {

				return getBuild( library.nodes[ id ], buildNode );

			} // visual scenes


			function parseVisualScene( xml ) {

				const data = {
					name: xml.getAttribute( 'name' ),
					children: []
				};
				prepareNodes( xml );
				const elements = getElementsByTagName( xml, 'node' );

				for ( let i = 0; i < elements.length; i ++ ) {

					data.children.push( parseNode( elements[ i ] ) );

				}

				library.visualScenes[ xml.getAttribute( 'id' ) ] = data;

			}

			function buildVisualScene( data ) {

				const group = new THREE.Group();
				group.name = data.name;
				const children = data.children;

				for ( let i = 0; i < children.length; i ++ ) {

					const child = children[ i ];
					group.add( getNode( child.id ) );

				}

				return group;

			}

			function hasVisualScene( id ) {

				return library.visualScenes[ id ] !== undefined;

			}

			function getVisualScene( id ) {

				return getBuild( library.visualScenes[ id ], buildVisualScene );

			} // scenes


			function parseScene( xml ) {

				const instance = getElementsByTagName( xml, 'instance_visual_scene' )[ 0 ];
				return getVisualScene( parseId( instance.getAttribute( 'url' ) ) );

			}

			function setupAnimations() {

				const clips = library.clips;

				if ( isEmpty( clips ) === true ) {

					if ( isEmpty( library.animations ) === false ) {

						// if there are animations but no clips, we create a default clip for playback
						const tracks = [];

						for ( const id in library.animations ) {

							const animationTracks = getAnimation( id );

							for ( let i = 0, l = animationTracks.length; i < l; i ++ ) {

								tracks.push( animationTracks[ i ] );

							}

						}

						animations.push( new THREE.AnimationClip( 'default', - 1, tracks ) );

					}

				} else {

					for ( const id in clips ) {

						animations.push( getAnimationClip( id ) );

					}

				}

			} // convert the parser error element into text with each child elements text
			// separated by new lines.


			function parserErrorToText( parserError ) {

				let result = '';
				const stack = [ parserError ];

				while ( stack.length ) {

					const node = stack.shift();

					if ( node.nodeType === Node.TEXT_NODE ) {

						result += node.textContent;

					} else {

						result += '\n';
						stack.push.apply( stack, node.childNodes );

					}

				}

				return result.trim();

			}

			if ( text.length === 0 ) {

				return {
					scene: new THREE.Scene()
				};

			}

			const xml = new DOMParser().parseFromString( text, 'application/xml' );
			const collada = getElementsByTagName( xml, 'COLLADA' )[ 0 ];
			const parserError = xml.getElementsByTagName( 'parsererror' )[ 0 ];

			if ( parserError !== undefined ) {

				// Chrome will return parser error with a div in it
				const errorElement = getElementsByTagName( parserError, 'div' )[ 0 ];
				let errorText;

				if ( errorElement ) {

					errorText = errorElement.textContent;

				} else {

					errorText = parserErrorToText( parserError );

				}

				console.error( 'THREE.ColladaLoader: Failed to parse collada file.\n', errorText );
				return null;

			} // metadata


			const version = collada.getAttribute( 'version' );
			console.log( 'THREE.ColladaLoader: File version', version );
			const asset = parseAsset( getElementsByTagName( collada, 'asset' )[ 0 ] );
			const textureLoader = new THREE.TextureLoader( this.manager );
			textureLoader.setPath( this.resourcePath || path ).setCrossOrigin( this.crossOrigin );
			let tgaLoader;

			if ( THREE.TGALoader ) {

				tgaLoader = new THREE.TGALoader( this.manager );
				tgaLoader.setPath( this.resourcePath || path );

			} //


			const animations = [];
			let kinematics = {};
			let count = 0; //

			const library = {
				animations: {},
				clips: {},
				controllers: {},
				images: {},
				effects: {},
				materials: {},
				cameras: {},
				lights: {},
				geometries: {},
				nodes: {},
				visualScenes: {},
				kinematicsModels: {},
				physicsModels: {},
				kinematicsScenes: {}
			};
			parseLibrary( collada, 'library_animations', 'animation', parseAnimation );
			parseLibrary( collada, 'library_animation_clips', 'animation_clip', parseAnimationClip );
			parseLibrary( collada, 'library_controllers', 'controller', parseController );
			parseLibrary( collada, 'library_images', 'image', parseImage );
			parseLibrary( collada, 'library_effects', 'effect', parseEffect );
			parseLibrary( collada, 'library_materials', 'material', parseMaterial );
			parseLibrary( collada, 'library_cameras', 'camera', parseCamera );
			parseLibrary( collada, 'library_lights', 'light', parseLight );
			parseLibrary( collada, 'library_geometries', 'geometry', parseGeometry );
			parseLibrary( collada, 'library_nodes', 'node', parseNode );
			parseLibrary( collada, 'library_visual_scenes', 'visual_scene', parseVisualScene );
			parseLibrary( collada, 'library_kinematics_models', 'kinematics_model', parseKinematicsModel );
			parseLibrary( collada, 'library_physics_models', 'physics_model', parsePhysicsModel );
			parseLibrary( collada, 'scene', 'instance_kinematics_scene', parseKinematicsScene );
			buildLibrary( library.animations, buildAnimation );
			buildLibrary( library.clips, buildAnimationClip );
			buildLibrary( library.controllers, buildController );
			buildLibrary( library.images, buildImage );
			buildLibrary( library.effects, buildEffect );
			buildLibrary( library.materials, buildMaterial );
			buildLibrary( library.cameras, buildCamera );
			buildLibrary( library.lights, buildLight );
			buildLibrary( library.geometries, buildGeometry );
			buildLibrary( library.visualScenes, buildVisualScene );
			setupAnimations();
			setupKinematics();
			const scene = parseScene( getElementsByTagName( collada, 'scene' )[ 0 ] );
			scene.animations = animations;

			if ( asset.upAxis === 'Z_UP' ) {

				scene.quaternion.setFromEuler( new THREE.Euler( - Math.PI / 2, 0, 0 ) );

			}

			scene.scale.multiplyScalar( asset.unit );
			return {
				get animations() {

					console.warn( 'THREE.ColladaLoader: Please access animations over scene.animations now.' );
					return animations;

				},

				kinematics: kinematics,
				library: library,
				scene: scene
			};

		}

	}

	THREE.ColladaLoader = ColladaLoader;

} )();

( function () {

	/**
 * Loads a Wavefront .mtl file specifying materials
 */

	class MTLLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );

		}
		/**
   * Loads and parses a MTL asset from a URL.
   *
   * @param {String} url - URL to the MTL file.
   * @param {Function} [onLoad] - Callback invoked with the loaded object.
   * @param {Function} [onProgress] - Callback for download progress.
   * @param {Function} [onError] - Callback for download errors.
   *
   * @see setPath setResourcePath
   *
   * @note In order for relative texture references to resolve correctly
   * you must call setResourcePath() explicitly prior to load.
   */


		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const path = this.path === '' ? THREE.LoaderUtils.extractUrlBase( url ) : this.path;
			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( text ) {

				try {

					onLoad( scope.parse( text, path ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		setMaterialOptions( value ) {

			this.materialOptions = value;
			return this;

		}
		/**
   * Parses a MTL file.
   *
   * @param {String} text - Content of MTL file
   * @return {MaterialCreator}
   *
   * @see setPath setResourcePath
   *
   * @note In order for relative texture references to resolve correctly
   * you must call setResourcePath() explicitly prior to parse.
   */


		parse( text, path ) {

			const lines = text.split( '\n' );
			let info = {};
			const delimiter_pattern = /\s+/;
			const materialsInfo = {};

			for ( let i = 0; i < lines.length; i ++ ) {

				let line = lines[ i ];
				line = line.trim();

				if ( line.length === 0 || line.charAt( 0 ) === '#' ) {

					// Blank line or comment ignore
					continue;

				}

				const pos = line.indexOf( ' ' );
				let key = pos >= 0 ? line.substring( 0, pos ) : line;
				key = key.toLowerCase();
				let value = pos >= 0 ? line.substring( pos + 1 ) : '';
				value = value.trim();

				if ( key === 'newmtl' ) {

					// New material
					info = {
						name: value
					};
					materialsInfo[ value ] = info;

				} else {

					if ( key === 'ka' || key === 'kd' || key === 'ks' || key === 'ke' ) {

						const ss = value.split( delimiter_pattern, 3 );
						info[ key ] = [ parseFloat( ss[ 0 ] ), parseFloat( ss[ 1 ] ), parseFloat( ss[ 2 ] ) ];

					} else {

						info[ key ] = value;

					}

				}

			}

			const materialCreator = new MaterialCreator( this.resourcePath || path, this.materialOptions );
			materialCreator.setCrossOrigin( this.crossOrigin );
			materialCreator.setManager( this.manager );
			materialCreator.setMaterials( materialsInfo );
			return materialCreator;

		}

	}
	/**
 * Create a new MTLLoader.MaterialCreator
 * @param baseUrl - Url relative to which textures are loaded
 * @param options - Set of options on how to construct the materials
 *                  side: Which side to apply the material
 *                        THREE.FrontSide (default), THREE.BackSide, THREE.DoubleSide
 *                  wrap: What type of wrapping to apply for textures
 *                        THREE.RepeatWrapping (default), THREE.ClampToEdgeWrapping, THREE.MirroredRepeatWrapping
 *                  normalizeRGB: RGBs need to be normalized to 0-1 from 0-255
 *                                Default: false, assumed to be already normalized
 *                  ignoreZeroRGBs: Ignore values of RGBs (Ka,Kd,Ks) that are all 0's
 *                                  Default: false
 * @constructor
 */


	class MaterialCreator {

		constructor( baseUrl = '', options = {} ) {

			this.baseUrl = baseUrl;
			this.options = options;
			this.materialsInfo = {};
			this.materials = {};
			this.materialsArray = [];
			this.nameLookup = {};
			this.crossOrigin = 'anonymous';
			this.side = this.options.side !== undefined ? this.options.side : THREE.FrontSide;
			this.wrap = this.options.wrap !== undefined ? this.options.wrap : THREE.RepeatWrapping;

		}

		setCrossOrigin( value ) {

			this.crossOrigin = value;
			return this;

		}

		setManager( value ) {

			this.manager = value;

		}

		setMaterials( materialsInfo ) {

			this.materialsInfo = this.convert( materialsInfo );
			this.materials = {};
			this.materialsArray = [];
			this.nameLookup = {};

		}

		convert( materialsInfo ) {

			if ( ! this.options ) return materialsInfo;
			const converted = {};

			for ( const mn in materialsInfo ) {

				// Convert materials info into normalized form based on options
				const mat = materialsInfo[ mn ];
				const covmat = {};
				converted[ mn ] = covmat;

				for ( const prop in mat ) {

					let save = true;
					let value = mat[ prop ];
					const lprop = prop.toLowerCase();

					switch ( lprop ) {

						case 'kd':
						case 'ka':
						case 'ks':
							// Diffuse color (color under white light) using RGB values
							if ( this.options && this.options.normalizeRGB ) {

								value = [ value[ 0 ] / 255, value[ 1 ] / 255, value[ 2 ] / 255 ];

							}

							if ( this.options && this.options.ignoreZeroRGBs ) {

								if ( value[ 0 ] === 0 && value[ 1 ] === 0 && value[ 2 ] === 0 ) {

									// ignore
									save = false;

								}

							}

							break;

						default:
							break;

					}

					if ( save ) {

						covmat[ lprop ] = value;

					}

				}

			}

			return converted;

		}

		preload() {

			for ( const mn in this.materialsInfo ) {

				this.create( mn );

			}

		}

		getIndex( materialName ) {

			return this.nameLookup[ materialName ];

		}

		getAsArray() {

			let index = 0;

			for ( const mn in this.materialsInfo ) {

				this.materialsArray[ index ] = this.create( mn );
				this.nameLookup[ mn ] = index;
				index ++;

			}

			return this.materialsArray;

		}

		create( materialName ) {

			if ( this.materials[ materialName ] === undefined ) {

				this.createMaterial_( materialName );

			}

			return this.materials[ materialName ];

		}

		createMaterial_( materialName ) {

			// Create material
			const scope = this;
			const mat = this.materialsInfo[ materialName ];
			const params = {
				name: materialName,
				side: this.side
			};

			function resolveURL( baseUrl, url ) {

				if ( typeof url !== 'string' || url === '' ) return ''; // Absolute URL

				if ( /^https?:\/\//i.test( url ) ) return url;
				return baseUrl + url;

			}

			function setMapForType( mapType, value ) {

				if ( params[ mapType ] ) return; // Keep the first encountered texture

				const texParams = scope.getTextureParams( value, params );
				const map = scope.loadTexture( resolveURL( scope.baseUrl, texParams.url ) );
				map.repeat.copy( texParams.scale );
				map.offset.copy( texParams.offset );
				map.wrapS = scope.wrap;
				map.wrapT = scope.wrap;
				params[ mapType ] = map;

			}

			for ( const prop in mat ) {

				const value = mat[ prop ];
				let n;
				if ( value === '' ) continue;

				switch ( prop.toLowerCase() ) {

					// Ns is material specular exponent
					case 'kd':
						// Diffuse color (color under white light) using RGB values
						params.color = new THREE.Color().fromArray( value );
						break;

					case 'ks':
						// Specular color (color when light is reflected from shiny surface) using RGB values
						params.specular = new THREE.Color().fromArray( value );
						break;

					case 'ke':
						// Emissive using RGB values
						params.emissive = new THREE.Color().fromArray( value );
						break;

					case 'map_kd':
						// Diffuse texture map
						setMapForType( 'map', value );
						break;

					case 'map_ks':
						// Specular map
						setMapForType( 'specularMap', value );
						break;

					case 'map_ke':
						// Emissive map
						setMapForType( 'emissiveMap', value );
						break;

					case 'norm':
						setMapForType( 'normalMap', value );
						break;

					case 'map_bump':
					case 'bump':
						// Bump texture map
						setMapForType( 'bumpMap', value );
						break;

					case 'map_d':
						// Alpha map
						setMapForType( 'alphaMap', value );
						params.transparent = true;
						break;

					case 'ns':
						// The specular exponent (defines the focus of the specular highlight)
						// A high exponent results in a tight, concentrated highlight. Ns values normally range from 0 to 1000.
						params.shininess = parseFloat( value );
						break;

					case 'd':
						n = parseFloat( value );

						if ( n < 1 ) {

							params.opacity = n;
							params.transparent = true;

						}

						break;

					case 'tr':
						n = parseFloat( value );
						if ( this.options && this.options.invertTrProperty ) n = 1 - n;

						if ( n > 0 ) {

							params.opacity = 1 - n;
							params.transparent = true;

						}

						break;

					default:
						break;

				}

			}

			this.materials[ materialName ] = new THREE.MeshPhongMaterial( params );
			return this.materials[ materialName ];

		}

		getTextureParams( value, matParams ) {

			const texParams = {
				scale: new THREE.Vector2( 1, 1 ),
				offset: new THREE.Vector2( 0, 0 )
			};
			const items = value.split( /\s+/ );
			let pos;
			pos = items.indexOf( '-bm' );

			if ( pos >= 0 ) {

				matParams.bumpScale = parseFloat( items[ pos + 1 ] );
				items.splice( pos, 2 );

			}

			pos = items.indexOf( '-s' );

			if ( pos >= 0 ) {

				texParams.scale.set( parseFloat( items[ pos + 1 ] ), parseFloat( items[ pos + 2 ] ) );
				items.splice( pos, 4 ); // we expect 3 parameters here!

			}

			pos = items.indexOf( '-o' );

			if ( pos >= 0 ) {

				texParams.offset.set( parseFloat( items[ pos + 1 ] ), parseFloat( items[ pos + 2 ] ) );
				items.splice( pos, 4 ); // we expect 3 parameters here!

			}

			texParams.url = items.join( ' ' ).trim();
			return texParams;

		}

		loadTexture( url, mapping, onLoad, onProgress, onError ) {

			const manager = this.manager !== undefined ? this.manager : THREE.DefaultLoadingManager;
			let loader = manager.getHandler( url );

			if ( loader === null ) {

				loader = new THREE.TextureLoader( manager );

			}

			if ( loader.setCrossOrigin ) loader.setCrossOrigin( this.crossOrigin );
			const texture = loader.load( url, onLoad, onProgress, onError );
			if ( mapping !== undefined ) texture.mapping = mapping;
			return texture;

		}

	}

	THREE.MTLLoader = MTLLoader;

} )();

( function () {

	const _object_pattern = /^[og]\s*(.+)?/; // mtllib file_reference

	const _material_library_pattern = /^mtllib /; // usemtl material_name

	const _material_use_pattern = /^usemtl /; // usemap map_name

	const _map_use_pattern = /^usemap /;

	const _vA = new THREE.Vector3();

	const _vB = new THREE.Vector3();

	const _vC = new THREE.Vector3();

	const _ab = new THREE.Vector3();

	const _cb = new THREE.Vector3();

	function ParserState() {

		const state = {
			objects: [],
			object: {},
			vertices: [],
			normals: [],
			colors: [],
			uvs: [],
			materials: {},
			materialLibraries: [],
			startObject: function ( name, fromDeclaration ) {

				// If the current object (initial from reset) is not from a g/o declaration in the parsed
				// file. We need to use it for the first parsed g/o to keep things in sync.
				if ( this.object && this.object.fromDeclaration === false ) {

					this.object.name = name;
					this.object.fromDeclaration = fromDeclaration !== false;
					return;

				}

				const previousMaterial = this.object && typeof this.object.currentMaterial === 'function' ? this.object.currentMaterial() : undefined;

				if ( this.object && typeof this.object._finalize === 'function' ) {

					this.object._finalize( true );

				}

				this.object = {
					name: name || '',
					fromDeclaration: fromDeclaration !== false,
					geometry: {
						vertices: [],
						normals: [],
						colors: [],
						uvs: [],
						hasUVIndices: false
					},
					materials: [],
					smooth: true,
					startMaterial: function ( name, libraries ) {

						const previous = this._finalize( false ); // New usemtl declaration overwrites an inherited material, except if faces were declared
						// after the material, then it must be preserved for proper MultiMaterial continuation.


						if ( previous && ( previous.inherited || previous.groupCount <= 0 ) ) {

							this.materials.splice( previous.index, 1 );

						}

						const material = {
							index: this.materials.length,
							name: name || '',
							mtllib: Array.isArray( libraries ) && libraries.length > 0 ? libraries[ libraries.length - 1 ] : '',
							smooth: previous !== undefined ? previous.smooth : this.smooth,
							groupStart: previous !== undefined ? previous.groupEnd : 0,
							groupEnd: - 1,
							groupCount: - 1,
							inherited: false,
							clone: function ( index ) {

								const cloned = {
									index: typeof index === 'number' ? index : this.index,
									name: this.name,
									mtllib: this.mtllib,
									smooth: this.smooth,
									groupStart: 0,
									groupEnd: - 1,
									groupCount: - 1,
									inherited: false
								};
								cloned.clone = this.clone.bind( cloned );
								return cloned;

							}
						};
						this.materials.push( material );
						return material;

					},
					currentMaterial: function () {

						if ( this.materials.length > 0 ) {

							return this.materials[ this.materials.length - 1 ];

						}

						return undefined;

					},
					_finalize: function ( end ) {

						const lastMultiMaterial = this.currentMaterial();

						if ( lastMultiMaterial && lastMultiMaterial.groupEnd === - 1 ) {

							lastMultiMaterial.groupEnd = this.geometry.vertices.length / 3;
							lastMultiMaterial.groupCount = lastMultiMaterial.groupEnd - lastMultiMaterial.groupStart;
							lastMultiMaterial.inherited = false;

						} // Ignore objects tail materials if no face declarations followed them before a new o/g started.


						if ( end && this.materials.length > 1 ) {

							for ( let mi = this.materials.length - 1; mi >= 0; mi -- ) {

								if ( this.materials[ mi ].groupCount <= 0 ) {

									this.materials.splice( mi, 1 );

								}

							}

						} // Guarantee at least one empty material, this makes the creation later more straight forward.


						if ( end && this.materials.length === 0 ) {

							this.materials.push( {
								name: '',
								smooth: this.smooth
							} );

						}

						return lastMultiMaterial;

					}
				}; // Inherit previous objects material.
				// Spec tells us that a declared material must be set to all objects until a new material is declared.
				// If a usemtl declaration is encountered while this new object is being parsed, it will
				// overwrite the inherited material. Exception being that there was already face declarations
				// to the inherited material, then it will be preserved for proper MultiMaterial continuation.

				if ( previousMaterial && previousMaterial.name && typeof previousMaterial.clone === 'function' ) {

					const declared = previousMaterial.clone( 0 );
					declared.inherited = true;
					this.object.materials.push( declared );

				}

				this.objects.push( this.object );

			},
			finalize: function () {

				if ( this.object && typeof this.object._finalize === 'function' ) {

					this.object._finalize( true );

				}

			},
			parseVertexIndex: function ( value, len ) {

				const index = parseInt( value, 10 );
				return ( index >= 0 ? index - 1 : index + len / 3 ) * 3;

			},
			parseNormalIndex: function ( value, len ) {

				const index = parseInt( value, 10 );
				return ( index >= 0 ? index - 1 : index + len / 3 ) * 3;

			},
			parseUVIndex: function ( value, len ) {

				const index = parseInt( value, 10 );
				return ( index >= 0 ? index - 1 : index + len / 2 ) * 2;

			},
			addVertex: function ( a, b, c ) {

				const src = this.vertices;
				const dst = this.object.geometry.vertices;
				dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );
				dst.push( src[ b + 0 ], src[ b + 1 ], src[ b + 2 ] );
				dst.push( src[ c + 0 ], src[ c + 1 ], src[ c + 2 ] );

			},
			addVertexPoint: function ( a ) {

				const src = this.vertices;
				const dst = this.object.geometry.vertices;
				dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );

			},
			addVertexLine: function ( a ) {

				const src = this.vertices;
				const dst = this.object.geometry.vertices;
				dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );

			},
			addNormal: function ( a, b, c ) {

				const src = this.normals;
				const dst = this.object.geometry.normals;
				dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );
				dst.push( src[ b + 0 ], src[ b + 1 ], src[ b + 2 ] );
				dst.push( src[ c + 0 ], src[ c + 1 ], src[ c + 2 ] );

			},
			addFaceNormal: function ( a, b, c ) {

				const src = this.vertices;
				const dst = this.object.geometry.normals;

				_vA.fromArray( src, a );

				_vB.fromArray( src, b );

				_vC.fromArray( src, c );

				_cb.subVectors( _vC, _vB );

				_ab.subVectors( _vA, _vB );

				_cb.cross( _ab );

				_cb.normalize();

				dst.push( _cb.x, _cb.y, _cb.z );
				dst.push( _cb.x, _cb.y, _cb.z );
				dst.push( _cb.x, _cb.y, _cb.z );

			},
			addColor: function ( a, b, c ) {

				const src = this.colors;
				const dst = this.object.geometry.colors;
				if ( src[ a ] !== undefined ) dst.push( src[ a + 0 ], src[ a + 1 ], src[ a + 2 ] );
				if ( src[ b ] !== undefined ) dst.push( src[ b + 0 ], src[ b + 1 ], src[ b + 2 ] );
				if ( src[ c ] !== undefined ) dst.push( src[ c + 0 ], src[ c + 1 ], src[ c + 2 ] );

			},
			addUV: function ( a, b, c ) {

				const src = this.uvs;
				const dst = this.object.geometry.uvs;
				dst.push( src[ a + 0 ], src[ a + 1 ] );
				dst.push( src[ b + 0 ], src[ b + 1 ] );
				dst.push( src[ c + 0 ], src[ c + 1 ] );

			},
			addDefaultUV: function () {

				const dst = this.object.geometry.uvs;
				dst.push( 0, 0 );
				dst.push( 0, 0 );
				dst.push( 0, 0 );

			},
			addUVLine: function ( a ) {

				const src = this.uvs;
				const dst = this.object.geometry.uvs;
				dst.push( src[ a + 0 ], src[ a + 1 ] );

			},
			addFace: function ( a, b, c, ua, ub, uc, na, nb, nc ) {

				const vLen = this.vertices.length;
				let ia = this.parseVertexIndex( a, vLen );
				let ib = this.parseVertexIndex( b, vLen );
				let ic = this.parseVertexIndex( c, vLen );
				this.addVertex( ia, ib, ic );
				this.addColor( ia, ib, ic ); // normals

				if ( na !== undefined && na !== '' ) {

					const nLen = this.normals.length;
					ia = this.parseNormalIndex( na, nLen );
					ib = this.parseNormalIndex( nb, nLen );
					ic = this.parseNormalIndex( nc, nLen );
					this.addNormal( ia, ib, ic );

				} else {

					this.addFaceNormal( ia, ib, ic );

				} // uvs


				if ( ua !== undefined && ua !== '' ) {

					const uvLen = this.uvs.length;
					ia = this.parseUVIndex( ua, uvLen );
					ib = this.parseUVIndex( ub, uvLen );
					ic = this.parseUVIndex( uc, uvLen );
					this.addUV( ia, ib, ic );
					this.object.geometry.hasUVIndices = true;

				} else {

					// add placeholder values (for inconsistent face definitions)
					this.addDefaultUV();

				}

			},
			addPointGeometry: function ( vertices ) {

				this.object.geometry.type = 'Points';
				const vLen = this.vertices.length;

				for ( let vi = 0, l = vertices.length; vi < l; vi ++ ) {

					const index = this.parseVertexIndex( vertices[ vi ], vLen );
					this.addVertexPoint( index );
					this.addColor( index );

				}

			},
			addLineGeometry: function ( vertices, uvs ) {

				this.object.geometry.type = 'Line';
				const vLen = this.vertices.length;
				const uvLen = this.uvs.length;

				for ( let vi = 0, l = vertices.length; vi < l; vi ++ ) {

					this.addVertexLine( this.parseVertexIndex( vertices[ vi ], vLen ) );

				}

				for ( let uvi = 0, l = uvs.length; uvi < l; uvi ++ ) {

					this.addUVLine( this.parseUVIndex( uvs[ uvi ], uvLen ) );

				}

			}
		};
		state.startObject( '', false );
		return state;

	} //


	class OBJLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );
			this.materials = null;

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( text ) {

				try {

					onLoad( scope.parse( text ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		setMaterials( materials ) {

			this.materials = materials;
			return this;

		}

		parse( text ) {

			const state = new ParserState();

			if ( text.indexOf( '\r\n' ) !== - 1 ) {

				// This is faster than String.split with regex that splits on both
				text = text.replace( /\r\n/g, '\n' );

			}

			if ( text.indexOf( '\\\n' ) !== - 1 ) {

				// join lines separated by a line continuation character (\)
				text = text.replace( /\\\n/g, '' );

			}

			const lines = text.split( '\n' );
			let line = '',
				lineFirstChar = '';
			let lineLength = 0;
			let result = []; // Faster to just trim left side of the line. Use if available.

			const trimLeft = typeof ''.trimLeft === 'function';

			for ( let i = 0, l = lines.length; i < l; i ++ ) {

				line = lines[ i ];
				line = trimLeft ? line.trimLeft() : line.trim();
				lineLength = line.length;
				if ( lineLength === 0 ) continue;
				lineFirstChar = line.charAt( 0 ); // @todo invoke passed in handler if any

				if ( lineFirstChar === '#' ) continue;

				if ( lineFirstChar === 'v' ) {

					const data = line.split( /\s+/ );

					switch ( data[ 0 ] ) {

						case 'v':
							state.vertices.push( parseFloat( data[ 1 ] ), parseFloat( data[ 2 ] ), parseFloat( data[ 3 ] ) );

							if ( data.length >= 7 ) {

								state.colors.push( parseFloat( data[ 4 ] ), parseFloat( data[ 5 ] ), parseFloat( data[ 6 ] ) );

							} else {

								// if no colors are defined, add placeholders so color and vertex indices match
								state.colors.push( undefined, undefined, undefined );

							}

							break;

						case 'vn':
							state.normals.push( parseFloat( data[ 1 ] ), parseFloat( data[ 2 ] ), parseFloat( data[ 3 ] ) );
							break;

						case 'vt':
							state.uvs.push( parseFloat( data[ 1 ] ), parseFloat( data[ 2 ] ) );
							break;

					}

				} else if ( lineFirstChar === 'f' ) {

					const lineData = line.substr( 1 ).trim();
					const vertexData = lineData.split( /\s+/ );
					const faceVertices = []; // Parse the face vertex data into an easy to work with format

					for ( let j = 0, jl = vertexData.length; j < jl; j ++ ) {

						const vertex = vertexData[ j ];

						if ( vertex.length > 0 ) {

							const vertexParts = vertex.split( '/' );
							faceVertices.push( vertexParts );

						}

					} // Draw an edge between the first vertex and all subsequent vertices to form an n-gon


					const v1 = faceVertices[ 0 ];

					for ( let j = 1, jl = faceVertices.length - 1; j < jl; j ++ ) {

						const v2 = faceVertices[ j ];
						const v3 = faceVertices[ j + 1 ];
						state.addFace( v1[ 0 ], v2[ 0 ], v3[ 0 ], v1[ 1 ], v2[ 1 ], v3[ 1 ], v1[ 2 ], v2[ 2 ], v3[ 2 ] );

					}

				} else if ( lineFirstChar === 'l' ) {

					const lineParts = line.substring( 1 ).trim().split( ' ' );
					let lineVertices = [];
					const lineUVs = [];

					if ( line.indexOf( '/' ) === - 1 ) {

						lineVertices = lineParts;

					} else {

						for ( let li = 0, llen = lineParts.length; li < llen; li ++ ) {

							const parts = lineParts[ li ].split( '/' );
							if ( parts[ 0 ] !== '' ) lineVertices.push( parts[ 0 ] );
							if ( parts[ 1 ] !== '' ) lineUVs.push( parts[ 1 ] );

						}

					}

					state.addLineGeometry( lineVertices, lineUVs );

				} else if ( lineFirstChar === 'p' ) {

					const lineData = line.substr( 1 ).trim();
					const pointData = lineData.split( ' ' );
					state.addPointGeometry( pointData );

				} else if ( ( result = _object_pattern.exec( line ) ) !== null ) {

					// o object_name
					// or
					// g group_name
					// WORKAROUND: https://bugs.chromium.org/p/v8/issues/detail?id=2869
					// let name = result[ 0 ].substr( 1 ).trim();
					const name = ( ' ' + result[ 0 ].substr( 1 ).trim() ).substr( 1 );
					state.startObject( name );

				} else if ( _material_use_pattern.test( line ) ) {

					// material
					state.object.startMaterial( line.substring( 7 ).trim(), state.materialLibraries );

				} else if ( _material_library_pattern.test( line ) ) {

					// mtl file
					state.materialLibraries.push( line.substring( 7 ).trim() );

				} else if ( _map_use_pattern.test( line ) ) {

					// the line is parsed but ignored since the loader assumes textures are defined MTL files
					// (according to https://www.okino.com/conv/imp_wave.htm, 'usemap' is the old-style Wavefront texture reference method)
					console.warn( 'THREE.OBJLoader: Rendering identifier "usemap" not supported. Textures must be defined in MTL files.' );

				} else if ( lineFirstChar === 's' ) {

					result = line.split( ' ' ); // smooth shading
					// @todo Handle files that have varying smooth values for a set of faces inside one geometry,
					// but does not define a usemtl for each face set.
					// This should be detected and a dummy material created (later MultiMaterial and geometry groups).
					// This requires some care to not create extra material on each smooth value for "normal" obj files.
					// where explicit usemtl defines geometry groups.
					// Example asset: examples/models/obj/cerberus/Cerberus.obj

					/*
        	 * http://paulbourke.net/dataformats/obj/
        	 * or
        	 * http://www.cs.utah.edu/~boulos/cs3505/obj_spec.pdf
        	 *
        	 * From chapter "Grouping" Syntax explanation "s group_number":
        	 * "group_number is the smoothing group number. To turn off smoothing groups, use a value of 0 or off.
        	 * Polygonal elements use group numbers to put elements in different smoothing groups. For free-form
        	 * surfaces, smoothing groups are either turned on or off; there is no difference between values greater
        	 * than 0."
        	 */

					if ( result.length > 1 ) {

						const value = result[ 1 ].trim().toLowerCase();
						state.object.smooth = value !== '0' && value !== 'off';

					} else {

						// ZBrush can produce "s" lines #11707
						state.object.smooth = true;

					}

					const material = state.object.currentMaterial();
					if ( material ) material.smooth = state.object.smooth;

				} else {

					// Handle null terminated files without exception
					if ( line === '\0' ) continue;
					console.warn( 'THREE.OBJLoader: Unexpected line: "' + line + '"' );

				}

			}

			state.finalize();
			const container = new THREE.Group();
			container.materialLibraries = [].concat( state.materialLibraries );
			const hasPrimitives = ! ( state.objects.length === 1 && state.objects[ 0 ].geometry.vertices.length === 0 );

			if ( hasPrimitives === true ) {

				for ( let i = 0, l = state.objects.length; i < l; i ++ ) {

					const object = state.objects[ i ];
					const geometry = object.geometry;
					const materials = object.materials;
					const isLine = geometry.type === 'Line';
					const isPoints = geometry.type === 'Points';
					let hasVertexColors = false; // Skip o/g line declarations that did not follow with any faces

					if ( geometry.vertices.length === 0 ) continue;
					const buffergeometry = new THREE.BufferGeometry();
					buffergeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( geometry.vertices, 3 ) );

					if ( geometry.normals.length > 0 ) {

						buffergeometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( geometry.normals, 3 ) );

					}

					if ( geometry.colors.length > 0 ) {

						hasVertexColors = true;
						buffergeometry.setAttribute( 'color', new THREE.Float32BufferAttribute( geometry.colors, 3 ) );

					}

					if ( geometry.hasUVIndices === true ) {

						buffergeometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( geometry.uvs, 2 ) );

					} // Create materials


					const createdMaterials = [];

					for ( let mi = 0, miLen = materials.length; mi < miLen; mi ++ ) {

						const sourceMaterial = materials[ mi ];
						const materialHash = sourceMaterial.name + '_' + sourceMaterial.smooth + '_' + hasVertexColors;
						let material = state.materials[ materialHash ];

						if ( this.materials !== null ) {

							material = this.materials.create( sourceMaterial.name ); // mtl etc. loaders probably can't create line materials correctly, copy properties to a line material.

							if ( isLine && material && ! ( material instanceof THREE.LineBasicMaterial ) ) {

								const materialLine = new THREE.LineBasicMaterial();
								THREE.Material.prototype.copy.call( materialLine, material );
								materialLine.color.copy( material.color );
								material = materialLine;

							} else if ( isPoints && material && ! ( material instanceof THREE.PointsMaterial ) ) {

								const materialPoints = new THREE.PointsMaterial( {
									size: 10,
									sizeAttenuation: false
								} );
								THREE.Material.prototype.copy.call( materialPoints, material );
								materialPoints.color.copy( material.color );
								materialPoints.map = material.map;
								material = materialPoints;

							}

						}

						if ( material === undefined ) {

							if ( isLine ) {

								material = new THREE.LineBasicMaterial();

							} else if ( isPoints ) {

								material = new THREE.PointsMaterial( {
									size: 1,
									sizeAttenuation: false
								} );

							} else {

								material = new THREE.MeshPhongMaterial();

							}

							material.name = sourceMaterial.name;
							material.flatShading = sourceMaterial.smooth ? false : true;
							material.vertexColors = hasVertexColors;
							state.materials[ materialHash ] = material;

						}

						createdMaterials.push( material );

					} // Create mesh


					let mesh;

					if ( createdMaterials.length > 1 ) {

						for ( let mi = 0, miLen = materials.length; mi < miLen; mi ++ ) {

							const sourceMaterial = materials[ mi ];
							buffergeometry.addGroup( sourceMaterial.groupStart, sourceMaterial.groupCount, mi );

						}

						if ( isLine ) {

							mesh = new THREE.LineSegments( buffergeometry, createdMaterials );

						} else if ( isPoints ) {

							mesh = new THREE.Points( buffergeometry, createdMaterials );

						} else {

							mesh = new THREE.Mesh( buffergeometry, createdMaterials );

						}

					} else {

						if ( isLine ) {

							mesh = new THREE.LineSegments( buffergeometry, createdMaterials[ 0 ] );

						} else if ( isPoints ) {

							mesh = new THREE.Points( buffergeometry, createdMaterials[ 0 ] );

						} else {

							mesh = new THREE.Mesh( buffergeometry, createdMaterials[ 0 ] );

						}

					}

					mesh.name = object.name;
					container.add( mesh );

				}

			} else {

				// if there is only the default parser state object with no geometry data, interpret data as point cloud
				if ( state.vertices.length > 0 ) {

					const material = new THREE.PointsMaterial( {
						size: 1,
						sizeAttenuation: false
					} );
					const buffergeometry = new THREE.BufferGeometry();
					buffergeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( state.vertices, 3 ) );

					if ( state.colors.length > 0 && state.colors[ 0 ] !== undefined ) {

						buffergeometry.setAttribute( 'color', new THREE.Float32BufferAttribute( state.colors, 3 ) );
						material.vertexColors = true;

					}

					const points = new THREE.Points( buffergeometry, material );
					container.add( points );

				}

			}

			return container;

		}

	}

	THREE.OBJLoader = OBJLoader;

} )();

( function () {

	/**
 * Autodesk 3DS three.js file loader, based on lib3ds.
 *
 * Loads geometry with uv and materials basic properties with texture support.
 *
 * @class TDSLoader
 * @constructor
 */

	class TDSLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );
			this.debug = false;
			this.group = null;
			this.position = 0;
			this.materials = [];
			this.meshes = [];

		}
		/**
   * Load 3ds file from url.
   *
   * @method load
   * @param {[type]} url URL for the file.
   * @param {Function} onLoad onLoad callback, receives group Object3D as argument.
   * @param {Function} onProgress onProgress callback.
   * @param {Function} onError onError callback.
   */


		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const path = this.path === '' ? THREE.LoaderUtils.extractUrlBase( url ) : this.path;
			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( data ) {

				try {

					onLoad( scope.parse( data, path ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}
		/**
   * Parse arraybuffer data and load 3ds file.
   *
   * @method parse
   * @param {ArrayBuffer} arraybuffer Arraybuffer data to be loaded.
   * @param {String} path Path for external resources.
   * @return {Group} THREE.Group loaded from 3ds file.
   */


		parse( arraybuffer, path ) {

			this.group = new THREE.Group();
			this.position = 0;
			this.materials = [];
			this.meshes = [];
			this.readFile( arraybuffer, path );

			for ( let i = 0; i < this.meshes.length; i ++ ) {

				this.group.add( this.meshes[ i ] );

			}

			return this.group;

		}
		/**
   * Decode file content to read 3ds data.
   *
   * @method readFile
   * @param {ArrayBuffer} arraybuffer Arraybuffer data to be loaded.
   * @param {String} path Path for external resources.
   */


		readFile( arraybuffer, path ) {

			const data = new DataView( arraybuffer );
			const chunk = this.readChunk( data );

			if ( chunk.id === MLIBMAGIC || chunk.id === CMAGIC || chunk.id === M3DMAGIC ) {

				let next = this.nextChunk( data, chunk );

				while ( next !== 0 ) {

					if ( next === M3D_VERSION ) {

						const version = this.readDWord( data );
						this.debugMessage( '3DS file version: ' + version );

					} else if ( next === MDATA ) {

						this.resetPosition( data );
						this.readMeshData( data, path );

					} else {

						this.debugMessage( 'Unknown main chunk: ' + next.toString( 16 ) );

					}

					next = this.nextChunk( data, chunk );

				}

			}

			this.debugMessage( 'Parsed ' + this.meshes.length + ' meshes' );

		}
		/**
   * Read mesh data chunk.
   *
   * @method readMeshData
   * @param {Dataview} data Dataview in use.
   * @param {String} path Path for external resources.
   */


		readMeshData( data, path ) {

			const chunk = this.readChunk( data );
			let next = this.nextChunk( data, chunk );

			while ( next !== 0 ) {

				if ( next === MESH_VERSION ) {

					const version = + this.readDWord( data );
					this.debugMessage( 'Mesh Version: ' + version );

				} else if ( next === MASTER_SCALE ) {

					const scale = this.readFloat( data );
					this.debugMessage( 'Master scale: ' + scale );
					this.group.scale.set( scale, scale, scale );

				} else if ( next === NAMED_OBJECT ) {

					this.debugMessage( 'Named Object' );
					this.resetPosition( data );
					this.readNamedObject( data );

				} else if ( next === MAT_ENTRY ) {

					this.debugMessage( 'Material' );
					this.resetPosition( data );
					this.readMaterialEntry( data, path );

				} else {

					this.debugMessage( 'Unknown MDATA chunk: ' + next.toString( 16 ) );

				}

				next = this.nextChunk( data, chunk );

			}

		}
		/**
   * Read named object chunk.
   *
   * @method readNamedObject
   * @param {Dataview} data Dataview in use.
   */


		readNamedObject( data ) {

			const chunk = this.readChunk( data );
			const name = this.readString( data, 64 );
			chunk.cur = this.position;
			let next = this.nextChunk( data, chunk );

			while ( next !== 0 ) {

				if ( next === N_TRI_OBJECT ) {

					this.resetPosition( data );
					const mesh = this.readMesh( data );
					mesh.name = name;
					this.meshes.push( mesh );

				} else {

					this.debugMessage( 'Unknown named object chunk: ' + next.toString( 16 ) );

				}

				next = this.nextChunk( data, chunk );

			}

			this.endChunk( chunk );

		}
		/**
   * Read material data chunk and add it to the material list.
   *
   * @method readMaterialEntry
   * @param {Dataview} data Dataview in use.
   * @param {String} path Path for external resources.
   */


		readMaterialEntry( data, path ) {

			const chunk = this.readChunk( data );
			let next = this.nextChunk( data, chunk );
			const material = new THREE.MeshPhongMaterial();

			while ( next !== 0 ) {

				if ( next === MAT_NAME ) {

					material.name = this.readString( data, 64 );
					this.debugMessage( '   Name: ' + material.name );

				} else if ( next === MAT_WIRE ) {

					this.debugMessage( '   Wireframe' );
					material.wireframe = true;

				} else if ( next === MAT_WIRE_SIZE ) {

					const value = this.readByte( data );
					material.wireframeLinewidth = value;
					this.debugMessage( '   Wireframe Thickness: ' + value );

				} else if ( next === MAT_TWO_SIDE ) {

					material.side = THREE.DoubleSide;
					this.debugMessage( '   DoubleSided' );

				} else if ( next === MAT_ADDITIVE ) {

					this.debugMessage( '   Additive Blending' );
					material.blending = THREE.AdditiveBlending;

				} else if ( next === MAT_DIFFUSE ) {

					this.debugMessage( '   Diffuse THREE.Color' );
					material.color = this.readColor( data );

				} else if ( next === MAT_SPECULAR ) {

					this.debugMessage( '   Specular THREE.Color' );
					material.specular = this.readColor( data );

				} else if ( next === MAT_AMBIENT ) {

					this.debugMessage( '   Ambient color' );
					material.color = this.readColor( data );

				} else if ( next === MAT_SHININESS ) {

					const shininess = this.readPercentage( data );
					material.shininess = shininess * 100;
					this.debugMessage( '   Shininess : ' + shininess );

				} else if ( next === MAT_TRANSPARENCY ) {

					const transparency = this.readPercentage( data );
					material.opacity = 1 - transparency;
					this.debugMessage( '  Transparency : ' + transparency );
					material.transparent = material.opacity < 1 ? true : false;

				} else if ( next === MAT_TEXMAP ) {

					this.debugMessage( '   ColorMap' );
					this.resetPosition( data );
					material.map = this.readMap( data, path );

				} else if ( next === MAT_BUMPMAP ) {

					this.debugMessage( '   BumpMap' );
					this.resetPosition( data );
					material.bumpMap = this.readMap( data, path );

				} else if ( next === MAT_OPACMAP ) {

					this.debugMessage( '   OpacityMap' );
					this.resetPosition( data );
					material.alphaMap = this.readMap( data, path );

				} else if ( next === MAT_SPECMAP ) {

					this.debugMessage( '   SpecularMap' );
					this.resetPosition( data );
					material.specularMap = this.readMap( data, path );

				} else {

					this.debugMessage( '   Unknown material chunk: ' + next.toString( 16 ) );

				}

				next = this.nextChunk( data, chunk );

			}

			this.endChunk( chunk );
			this.materials[ material.name ] = material;

		}
		/**
   * Read mesh data chunk.
   *
   * @method readMesh
   * @param {Dataview} data Dataview in use.
   * @return {Mesh} The parsed mesh.
   */


		readMesh( data ) {

			const chunk = this.readChunk( data );
			let next = this.nextChunk( data, chunk );
			const geometry = new THREE.BufferGeometry();
			const material = new THREE.MeshPhongMaterial();
			const mesh = new THREE.Mesh( geometry, material );
			mesh.name = 'mesh';

			while ( next !== 0 ) {

				if ( next === POINT_ARRAY ) {

					const points = this.readWord( data );
					this.debugMessage( '   Vertex: ' + points ); //BufferGeometry

					const vertices = [];

					for ( let i = 0; i < points; i ++ ) {

						vertices.push( this.readFloat( data ) );
						vertices.push( this.readFloat( data ) );
						vertices.push( this.readFloat( data ) );

					}

					geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );

				} else if ( next === FACE_ARRAY ) {

					this.resetPosition( data );
					this.readFaceArray( data, mesh );

				} else if ( next === TEX_VERTS ) {

					const texels = this.readWord( data );
					this.debugMessage( '   UV: ' + texels ); //BufferGeometry

					const uvs = [];

					for ( let i = 0; i < texels; i ++ ) {

						uvs.push( this.readFloat( data ) );
						uvs.push( this.readFloat( data ) );

					}

					geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

				} else if ( next === MESH_MATRIX ) {

					this.debugMessage( '   Tranformation Matrix (TODO)' );
					const values = [];

					for ( let i = 0; i < 12; i ++ ) {

						values[ i ] = this.readFloat( data );

					}

					const matrix = new THREE.Matrix4(); //X Line

					matrix.elements[ 0 ] = values[ 0 ];
					matrix.elements[ 1 ] = values[ 6 ];
					matrix.elements[ 2 ] = values[ 3 ];
					matrix.elements[ 3 ] = values[ 9 ]; //Y Line

					matrix.elements[ 4 ] = values[ 2 ];
					matrix.elements[ 5 ] = values[ 8 ];
					matrix.elements[ 6 ] = values[ 5 ];
					matrix.elements[ 7 ] = values[ 11 ]; //Z Line

					matrix.elements[ 8 ] = values[ 1 ];
					matrix.elements[ 9 ] = values[ 7 ];
					matrix.elements[ 10 ] = values[ 4 ];
					matrix.elements[ 11 ] = values[ 10 ]; //W Line

					matrix.elements[ 12 ] = 0;
					matrix.elements[ 13 ] = 0;
					matrix.elements[ 14 ] = 0;
					matrix.elements[ 15 ] = 1;
					matrix.transpose();
					const inverse = new THREE.Matrix4();
					inverse.copy( matrix ).invert();
					geometry.applyMatrix4( inverse );
					matrix.decompose( mesh.position, mesh.quaternion, mesh.scale );

				} else {

					this.debugMessage( '   Unknown mesh chunk: ' + next.toString( 16 ) );

				}

				next = this.nextChunk( data, chunk );

			}

			this.endChunk( chunk );
			geometry.computeVertexNormals();
			return mesh;

		}
		/**
   * Read face array data chunk.
   *
   * @method readFaceArray
   * @param {Dataview} data Dataview in use.
   * @param {Mesh} mesh THREE.Mesh to be filled with the data read.
   */


		readFaceArray( data, mesh ) {

			const chunk = this.readChunk( data );
			const faces = this.readWord( data );
			this.debugMessage( '   Faces: ' + faces );
			const index = [];

			for ( let i = 0; i < faces; ++ i ) {

				index.push( this.readWord( data ), this.readWord( data ), this.readWord( data ) );
				this.readWord( data ); // visibility

			}

			mesh.geometry.setIndex( index ); //The rest of the FACE_ARRAY chunk is subchunks

			let materialIndex = 0;
			let start = 0;

			while ( this.position < chunk.end ) {

				const subchunk = this.readChunk( data );

				if ( subchunk.id === MSH_MAT_GROUP ) {

					this.debugMessage( '      Material THREE.Group' );
					this.resetPosition( data );
					const group = this.readMaterialGroup( data );
					const count = group.index.length * 3; // assuming successive indices

					mesh.geometry.addGroup( start, count, materialIndex );
					start += count;
					materialIndex ++;
					const material = this.materials[ group.name ];
					if ( Array.isArray( mesh.material ) === false ) mesh.material = [];

					if ( material !== undefined ) {

						mesh.material.push( material );

					}

				} else {

					this.debugMessage( '      Unknown face array chunk: ' + subchunk.toString( 16 ) );

				}

				this.endChunk( subchunk );

			}

			if ( mesh.material.length === 1 ) mesh.material = mesh.material[ 0 ]; // for backwards compatibility

			this.endChunk( chunk );

		}
		/**
   * Read texture map data chunk.
   *
   * @method readMap
   * @param {Dataview} data Dataview in use.
   * @param {String} path Path for external resources.
   * @return {Texture} Texture read from this data chunk.
   */


		readMap( data, path ) {

			const chunk = this.readChunk( data );
			let next = this.nextChunk( data, chunk );
			let texture = {};
			const loader = new THREE.TextureLoader( this.manager );
			loader.setPath( this.resourcePath || path ).setCrossOrigin( this.crossOrigin );

			while ( next !== 0 ) {

				if ( next === MAT_MAPNAME ) {

					const name = this.readString( data, 128 );
					texture = loader.load( name );
					this.debugMessage( '      File: ' + path + name );

				} else if ( next === MAT_MAP_UOFFSET ) {

					texture.offset.x = this.readFloat( data );
					this.debugMessage( '      OffsetX: ' + texture.offset.x );

				} else if ( next === MAT_MAP_VOFFSET ) {

					texture.offset.y = this.readFloat( data );
					this.debugMessage( '      OffsetY: ' + texture.offset.y );

				} else if ( next === MAT_MAP_USCALE ) {

					texture.repeat.x = this.readFloat( data );
					this.debugMessage( '      RepeatX: ' + texture.repeat.x );

				} else if ( next === MAT_MAP_VSCALE ) {

					texture.repeat.y = this.readFloat( data );
					this.debugMessage( '      RepeatY: ' + texture.repeat.y );

				} else {

					this.debugMessage( '      Unknown map chunk: ' + next.toString( 16 ) );

				}

				next = this.nextChunk( data, chunk );

			}

			this.endChunk( chunk );
			return texture;

		}
		/**
   * Read material group data chunk.
   *
   * @method readMaterialGroup
   * @param {Dataview} data Dataview in use.
   * @return {Object} Object with name and index of the object.
   */


		readMaterialGroup( data ) {

			this.readChunk( data );
			const name = this.readString( data, 64 );
			const numFaces = this.readWord( data );
			this.debugMessage( '         Name: ' + name );
			this.debugMessage( '         Faces: ' + numFaces );
			const index = [];

			for ( let i = 0; i < numFaces; ++ i ) {

				index.push( this.readWord( data ) );

			}

			return {
				name: name,
				index: index
			};

		}
		/**
   * Read a color value.
   *
   * @method readColor
   * @param {DataView} data Dataview.
   * @return {Color} THREE.Color value read..
   */


		readColor( data ) {

			const chunk = this.readChunk( data );
			const color = new THREE.Color();

			if ( chunk.id === COLOR_24 || chunk.id === LIN_COLOR_24 ) {

				const r = this.readByte( data );
				const g = this.readByte( data );
				const b = this.readByte( data );
				color.setRGB( r / 255, g / 255, b / 255 );
				this.debugMessage( '      THREE.Color: ' + color.r + ', ' + color.g + ', ' + color.b );

			} else if ( chunk.id === COLOR_F || chunk.id === LIN_COLOR_F ) {

				const r = this.readFloat( data );
				const g = this.readFloat( data );
				const b = this.readFloat( data );
				color.setRGB( r, g, b );
				this.debugMessage( '      THREE.Color: ' + color.r + ', ' + color.g + ', ' + color.b );

			} else {

				this.debugMessage( '      Unknown color chunk: ' + chunk.toString( 16 ) );

			}

			this.endChunk( chunk );
			return color;

		}
		/**
   * Read next chunk of data.
   *
   * @method readChunk
   * @param {DataView} data Dataview.
   * @return {Object} Chunk of data read.
   */


		readChunk( data ) {

			const chunk = {};
			chunk.cur = this.position;
			chunk.id = this.readWord( data );
			chunk.size = this.readDWord( data );
			chunk.end = chunk.cur + chunk.size;
			chunk.cur += 6;
			return chunk;

		}
		/**
   * Set position to the end of the current chunk of data.
   *
   * @method endChunk
   * @param {Object} chunk Data chunk.
   */


		endChunk( chunk ) {

			this.position = chunk.end;

		}
		/**
   * Move to the next data chunk.
   *
   * @method nextChunk
   * @param {DataView} data Dataview.
   * @param {Object} chunk Data chunk.
   */


		nextChunk( data, chunk ) {

			if ( chunk.cur >= chunk.end ) {

				return 0;

			}

			this.position = chunk.cur;

			try {

				const next = this.readChunk( data );
				chunk.cur += next.size;
				return next.id;

			} catch ( e ) {

				this.debugMessage( 'Unable to read chunk at ' + this.position );
				return 0;

			}

		}
		/**
   * Reset dataview position.
   *
   * @method resetPosition
   */


		resetPosition() {

			this.position -= 6;

		}
		/**
   * Read byte value.
   *
   * @method readByte
   * @param {DataView} data Dataview to read data from.
   * @return {Number} Data read from the dataview.
   */


		readByte( data ) {

			const v = data.getUint8( this.position, true );
			this.position += 1;
			return v;

		}
		/**
   * Read 32 bit float value.
   *
   * @method readFloat
   * @param {DataView} data Dataview to read data from.
   * @return {Number} Data read from the dataview.
   */


		readFloat( data ) {

			try {

				const v = data.getFloat32( this.position, true );
				this.position += 4;
				return v;

			} catch ( e ) {

				this.debugMessage( e + ' ' + this.position + ' ' + data.byteLength );

			}

		}
		/**
   * Read 32 bit signed integer value.
   *
   * @method readInt
   * @param {DataView} data Dataview to read data from.
   * @return {Number} Data read from the dataview.
   */


		readInt( data ) {

			const v = data.getInt32( this.position, true );
			this.position += 4;
			return v;

		}
		/**
   * Read 16 bit signed integer value.
   *
   * @method readShort
   * @param {DataView} data Dataview to read data from.
   * @return {Number} Data read from the dataview.
   */


		readShort( data ) {

			const v = data.getInt16( this.position, true );
			this.position += 2;
			return v;

		}
		/**
   * Read 64 bit unsigned integer value.
   *
   * @method readDWord
   * @param {DataView} data Dataview to read data from.
   * @return {Number} Data read from the dataview.
   */


		readDWord( data ) {

			const v = data.getUint32( this.position, true );
			this.position += 4;
			return v;

		}
		/**
   * Read 32 bit unsigned integer value.
   *
   * @method readWord
   * @param {DataView} data Dataview to read data from.
   * @return {Number} Data read from the dataview.
   */


		readWord( data ) {

			const v = data.getUint16( this.position, true );
			this.position += 2;
			return v;

		}
		/**
   * Read string value.
   *
   * @method readString
   * @param {DataView} data Dataview to read data from.
   * @param {Number} maxLength Max size of the string to be read.
   * @return {String} Data read from the dataview.
   */


		readString( data, maxLength ) {

			let s = '';

			for ( let i = 0; i < maxLength; i ++ ) {

				const c = this.readByte( data );

				if ( ! c ) {

					break;

				}

				s += String.fromCharCode( c );

			}

			return s;

		}
		/**
   * Read percentage value.
   *
   * @method readPercentage
   * @param {DataView} data Dataview to read data from.
   * @return {Number} Data read from the dataview.
   */


		readPercentage( data ) {

			const chunk = this.readChunk( data );
			let value;

			switch ( chunk.id ) {

				case INT_PERCENTAGE:
					value = this.readShort( data ) / 100;
					break;

				case FLOAT_PERCENTAGE:
					value = this.readFloat( data );
					break;

				default:
					this.debugMessage( '      Unknown percentage chunk: ' + chunk.toString( 16 ) );

			}

			this.endChunk( chunk );
			return value;

		}
		/**
   * Print debug message to the console.
   *
   * Is controlled by a flag to show or hide debug messages.
   *
   * @method debugMessage
   * @param {Object} message Debug message to print to the console.
   */


		debugMessage( message ) {

			if ( this.debug ) {

				console.log( message );

			}

		}

	} // const NULL_CHUNK = 0x0000;


	const M3DMAGIC = 0x4D4D; // const SMAGIC = 0x2D2D;
	// const LMAGIC = 0x2D3D;

	const MLIBMAGIC = 0x3DAA; // const MATMAGIC = 0x3DFF;

	const CMAGIC = 0xC23D;
	const M3D_VERSION = 0x0002; // const M3D_KFVERSION = 0x0005;

	const COLOR_F = 0x0010;
	const COLOR_24 = 0x0011;
	const LIN_COLOR_24 = 0x0012;
	const LIN_COLOR_F = 0x0013;
	const INT_PERCENTAGE = 0x0030;
	const FLOAT_PERCENTAGE = 0x0031;
	const MDATA = 0x3D3D;
	const MESH_VERSION = 0x3D3E;
	const MASTER_SCALE = 0x0100; // const LO_SHADOW_BIAS = 0x1400;
	// const HI_SHADOW_BIAS = 0x1410;
	// const SHADOW_MAP_SIZE = 0x1420;
	// const SHADOW_SAMPLES = 0x1430;
	// const SHADOW_RANGE = 0x1440;
	// const SHADOW_FILTER = 0x1450;
	// const RAY_BIAS = 0x1460;
	// const O_CONSTS = 0x1500;
	// const AMBIENT_LIGHT = 0x2100;
	// const BIT_MAP = 0x1100;
	// const SOLID_BGND = 0x1200;
	// const V_GRADIENT = 0x1300;
	// const USE_BIT_MAP = 0x1101;
	// const USE_SOLID_BGND = 0x1201;
	// const USE_V_GRADIENT = 0x1301;
	// const FOG = 0x2200;
	// const FOG_BGND = 0x2210;
	// const LAYER_FOG = 0x2302;
	// const DISTANCE_CUE = 0x2300;
	// const DCUE_BGND = 0x2310;
	// const USE_FOG = 0x2201;
	// const USE_LAYER_FOG = 0x2303;
	// const USE_DISTANCE_CUE = 0x2301;

	const MAT_ENTRY = 0xAFFF;
	const MAT_NAME = 0xA000;
	const MAT_AMBIENT = 0xA010;
	const MAT_DIFFUSE = 0xA020;
	const MAT_SPECULAR = 0xA030;
	const MAT_SHININESS = 0xA040; // const MAT_SHIN2PCT = 0xA041;

	const MAT_TRANSPARENCY = 0xA050; // const MAT_XPFALL = 0xA052;
	// const MAT_USE_XPFALL = 0xA240;
	// const MAT_REFBLUR = 0xA053;
	// const MAT_SHADING = 0xA100;
	// const MAT_USE_REFBLUR = 0xA250;
	// const MAT_SELF_ILLUM = 0xA084;

	const MAT_TWO_SIDE = 0xA081; // const MAT_DECAL = 0xA082;

	const MAT_ADDITIVE = 0xA083;
	const MAT_WIRE = 0xA085; // const MAT_FACEMAP = 0xA088;
	// const MAT_TRANSFALLOFF_IN = 0xA08A;
	// const MAT_PHONGSOFT = 0xA08C;
	// const MAT_WIREABS = 0xA08E;

	const MAT_WIRE_SIZE = 0xA087;
	const MAT_TEXMAP = 0xA200; // const MAT_SXP_TEXT_DATA = 0xA320;
	// const MAT_TEXMASK = 0xA33E;
	// const MAT_SXP_TEXTMASK_DATA = 0xA32A;
	// const MAT_TEX2MAP = 0xA33A;
	// const MAT_SXP_TEXT2_DATA = 0xA321;
	// const MAT_TEX2MASK = 0xA340;
	// const MAT_SXP_TEXT2MASK_DATA = 0xA32C;

	const MAT_OPACMAP = 0xA210; // const MAT_SXP_OPAC_DATA = 0xA322;
	// const MAT_OPACMASK = 0xA342;
	// const MAT_SXP_OPACMASK_DATA = 0xA32E;

	const MAT_BUMPMAP = 0xA230; // const MAT_SXP_BUMP_DATA = 0xA324;
	// const MAT_BUMPMASK = 0xA344;
	// const MAT_SXP_BUMPMASK_DATA = 0xA330;

	const MAT_SPECMAP = 0xA204; // const MAT_SXP_SPEC_DATA = 0xA325;
	// const MAT_SPECMASK = 0xA348;
	// const MAT_SXP_SPECMASK_DATA = 0xA332;
	// const MAT_SHINMAP = 0xA33C;
	// const MAT_SXP_SHIN_DATA = 0xA326;
	// const MAT_SHINMASK = 0xA346;
	// const MAT_SXP_SHINMASK_DATA = 0xA334;
	// const MAT_SELFIMAP = 0xA33D;
	// const MAT_SXP_SELFI_DATA = 0xA328;
	// const MAT_SELFIMASK = 0xA34A;
	// const MAT_SXP_SELFIMASK_DATA = 0xA336;
	// const MAT_REFLMAP = 0xA220;
	// const MAT_REFLMASK = 0xA34C;
	// const MAT_SXP_REFLMASK_DATA = 0xA338;
	// const MAT_ACUBIC = 0xA310;

	const MAT_MAPNAME = 0xA300; // const MAT_MAP_TILING = 0xA351;
	// const MAT_MAP_TEXBLUR = 0xA353;

	const MAT_MAP_USCALE = 0xA354;
	const MAT_MAP_VSCALE = 0xA356;
	const MAT_MAP_UOFFSET = 0xA358;
	const MAT_MAP_VOFFSET = 0xA35A; // const MAT_MAP_ANG = 0xA35C;
	// const MAT_MAP_COL1 = 0xA360;
	// const MAT_MAP_COL2 = 0xA362;
	// const MAT_MAP_RCOL = 0xA364;
	// const MAT_MAP_GCOL = 0xA366;
	// const MAT_MAP_BCOL = 0xA368;

	const NAMED_OBJECT = 0x4000; // const N_DIRECT_LIGHT = 0x4600;
	// const DL_OFF = 0x4620;
	// const DL_OUTER_RANGE = 0x465A;
	// const DL_INNER_RANGE = 0x4659;
	// const DL_MULTIPLIER = 0x465B;
	// const DL_EXCLUDE = 0x4654;
	// const DL_ATTENUATE = 0x4625;
	// const DL_SPOTLIGHT = 0x4610;
	// const DL_SPOT_ROLL = 0x4656;
	// const DL_SHADOWED = 0x4630;
	// const DL_LOCAL_SHADOW2 = 0x4641;
	// const DL_SEE_CONE = 0x4650;
	// const DL_SPOT_RECTANGULAR = 0x4651;
	// const DL_SPOT_ASPECT = 0x4657;
	// const DL_SPOT_PROJECTOR = 0x4653;
	// const DL_SPOT_OVERSHOOT = 0x4652;
	// const DL_RAY_BIAS = 0x4658;
	// const DL_RAYSHAD = 0x4627;
	// const N_CAMERA = 0x4700;
	// const CAM_SEE_CONE = 0x4710;
	// const CAM_RANGES = 0x4720;
	// const OBJ_HIDDEN = 0x4010;
	// const OBJ_VIS_LOFTER = 0x4011;
	// const OBJ_DOESNT_CAST = 0x4012;
	// const OBJ_DONT_RECVSHADOW = 0x4017;
	// const OBJ_MATTE = 0x4013;
	// const OBJ_FAST = 0x4014;
	// const OBJ_PROCEDURAL = 0x4015;
	// const OBJ_FROZEN = 0x4016;

	const N_TRI_OBJECT = 0x4100;
	const POINT_ARRAY = 0x4110; // const POINT_FLAG_ARRAY = 0x4111;

	const FACE_ARRAY = 0x4120;
	const MSH_MAT_GROUP = 0x4130; // const SMOOTH_GROUP = 0x4150;
	// const MSH_BOXMAP = 0x4190;

	const TEX_VERTS = 0x4140;
	const MESH_MATRIX = 0x4160; // const MESH_COLOR = 0x4165;

	THREE.TDSLoader = TDSLoader;

} )();

( function () {

	/**
 * Description: A THREE loader for STL ASCII files, as created by Solidworks and other CAD programs.
 *
 * Supports both binary and ASCII encoded files, with automatic detection of type.
 *
 * The loader returns a non-indexed buffer geometry.
 *
 * Limitations:
 *  Binary decoding supports "Magics" color format (http://en.wikipedia.org/wiki/STL_(file_format)#Color_in_binary_STL).
 *  There is perhaps some question as to how valid it is to always assume little-endian-ness.
 *  ASCII decoding assumes file is UTF-8.
 *
 * Usage:
 *  const loader = new STLLoader();
 *  loader.load( './models/stl/slotted_disk.stl', function ( geometry ) {
 *    scene.add( new THREE.Mesh( geometry ) );
 *  });
 *
 * For binary STLs geometry might contain colors for vertices. To use it:
 *  // use the same code to load STL as above
 *  if (geometry.hasColors) {
 *    material = new THREE.MeshPhongMaterial({ opacity: geometry.alpha, vertexColors: true });
 *  } else { .... }
 *  const mesh = new THREE.Mesh( geometry, material );
 *
 * For ASCII STLs containing multiple solids, each solid is assigned to a different group.
 * Groups can be used to assign a different color by defining an array of materials with the same length of
 * geometry.groups and passing it to the Mesh constructor:
 *
 * const mesh = new THREE.Mesh( geometry, material );
 *
 * For example:
 *
 *  const materials = [];
 *  const nGeometryGroups = geometry.groups.length;
 *
 *  const colorMap = ...; // Some logic to index colors.
 *
 *  for (let i = 0; i < nGeometryGroups; i++) {
 *
 *		const material = new THREE.MeshPhongMaterial({
 *			color: colorMap[i],
 *			wireframe: false
 *		});
 *
 *  }
 *
 *  materials.push(material);
 *  const mesh = new THREE.Mesh(geometry, materials);
 */

	class STLLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( text ) {

				try {

					onLoad( scope.parse( text ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		parse( data ) {

			function isBinary( data ) {

				const reader = new DataView( data );
				const face_size = 32 / 8 * 3 + 32 / 8 * 3 * 3 + 16 / 8;
				const n_faces = reader.getUint32( 80, true );
				const expect = 80 + 32 / 8 + n_faces * face_size;

				if ( expect === reader.byteLength ) {

					return true;

				} // An ASCII STL data must begin with 'solid ' as the first six bytes.
				// However, ASCII STLs lacking the SPACE after the 'd' are known to be
				// plentiful.  So, check the first 5 bytes for 'solid'.
				// Several encodings, such as UTF-8, precede the text with up to 5 bytes:
				// https://en.wikipedia.org/wiki/Byte_order_mark#Byte_order_marks_by_encoding
				// Search for "solid" to start anywhere after those prefixes.
				// US-ASCII ordinal values for 's', 'o', 'l', 'i', 'd'


				const solid = [ 115, 111, 108, 105, 100 ];

				for ( let off = 0; off < 5; off ++ ) {

					// If "solid" text is matched to the current offset, declare it to be an ASCII STL.
					if ( matchDataViewAt( solid, reader, off ) ) return false;

				} // Couldn't find "solid" text at the beginning; it is binary STL.


				return true;

			}

			function matchDataViewAt( query, reader, offset ) {

				// Check if each byte in query matches the corresponding byte from the current offset
				for ( let i = 0, il = query.length; i < il; i ++ ) {

					if ( query[ i ] !== reader.getUint8( offset + i, false ) ) return false;

				}

				return true;

			}

			function parseBinary( data ) {

				const reader = new DataView( data );
				const faces = reader.getUint32( 80, true );
				let r,
					g,
					b,
					hasColors = false,
					colors;
				let defaultR, defaultG, defaultB, alpha; // process STL header
				// check for default color in header ("COLOR=rgba" sequence).

				for ( let index = 0; index < 80 - 10; index ++ ) {

					if ( reader.getUint32( index, false ) == 0x434F4C4F
        /*COLO*/
        && reader.getUint8( index + 4 ) == 0x52
        /*'R'*/
        && reader.getUint8( index + 5 ) == 0x3D
        /*'='*/
					) {

						hasColors = true;
						colors = new Float32Array( faces * 3 * 3 );
						defaultR = reader.getUint8( index + 6 ) / 255;
						defaultG = reader.getUint8( index + 7 ) / 255;
						defaultB = reader.getUint8( index + 8 ) / 255;
						alpha = reader.getUint8( index + 9 ) / 255;

					}

				}

				const dataOffset = 84;
				const faceLength = 12 * 4 + 2;
				const geometry = new THREE.BufferGeometry();
				const vertices = new Float32Array( faces * 3 * 3 );
				const normals = new Float32Array( faces * 3 * 3 );

				for ( let face = 0; face < faces; face ++ ) {

					const start = dataOffset + face * faceLength;
					const normalX = reader.getFloat32( start, true );
					const normalY = reader.getFloat32( start + 4, true );
					const normalZ = reader.getFloat32( start + 8, true );

					if ( hasColors ) {

						const packedColor = reader.getUint16( start + 48, true );

						if ( ( packedColor & 0x8000 ) === 0 ) {

							// facet has its own unique color
							r = ( packedColor & 0x1F ) / 31;
							g = ( packedColor >> 5 & 0x1F ) / 31;
							b = ( packedColor >> 10 & 0x1F ) / 31;

						} else {

							r = defaultR;
							g = defaultG;
							b = defaultB;

						}

					}

					for ( let i = 1; i <= 3; i ++ ) {

						const vertexstart = start + i * 12;
						const componentIdx = face * 3 * 3 + ( i - 1 ) * 3;
						vertices[ componentIdx ] = reader.getFloat32( vertexstart, true );
						vertices[ componentIdx + 1 ] = reader.getFloat32( vertexstart + 4, true );
						vertices[ componentIdx + 2 ] = reader.getFloat32( vertexstart + 8, true );
						normals[ componentIdx ] = normalX;
						normals[ componentIdx + 1 ] = normalY;
						normals[ componentIdx + 2 ] = normalZ;

						if ( hasColors ) {

							colors[ componentIdx ] = r;
							colors[ componentIdx + 1 ] = g;
							colors[ componentIdx + 2 ] = b;

						}

					}

				}

				geometry.setAttribute( 'position', new THREE.BufferAttribute( vertices, 3 ) );
				geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3 ) );

				if ( hasColors ) {

					geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );
					geometry.hasColors = true;
					geometry.alpha = alpha;

				}

				return geometry;

			}

			function parseASCII( data ) {

				const geometry = new THREE.BufferGeometry();
				const patternSolid = /solid([\s\S]*?)endsolid/g;
				const patternFace = /facet([\s\S]*?)endfacet/g;
				let faceCounter = 0;
				const patternFloat = /[\s]+([+-]?(?:\d*)(?:\.\d*)?(?:[eE][+-]?\d+)?)/.source;
				const patternVertex = new RegExp( 'vertex' + patternFloat + patternFloat + patternFloat, 'g' );
				const patternNormal = new RegExp( 'normal' + patternFloat + patternFloat + patternFloat, 'g' );
				const vertices = [];
				const normals = [];
				const normal = new THREE.Vector3();
				let result;
				let groupCount = 0;
				let startVertex = 0;
				let endVertex = 0;

				while ( ( result = patternSolid.exec( data ) ) !== null ) {

					startVertex = endVertex;
					const solid = result[ 0 ];

					while ( ( result = patternFace.exec( solid ) ) !== null ) {

						let vertexCountPerFace = 0;
						let normalCountPerFace = 0;
						const text = result[ 0 ];

						while ( ( result = patternNormal.exec( text ) ) !== null ) {

							normal.x = parseFloat( result[ 1 ] );
							normal.y = parseFloat( result[ 2 ] );
							normal.z = parseFloat( result[ 3 ] );
							normalCountPerFace ++;

						}

						while ( ( result = patternVertex.exec( text ) ) !== null ) {

							vertices.push( parseFloat( result[ 1 ] ), parseFloat( result[ 2 ] ), parseFloat( result[ 3 ] ) );
							normals.push( normal.x, normal.y, normal.z );
							vertexCountPerFace ++;
							endVertex ++;

						} // every face have to own ONE valid normal


						if ( normalCountPerFace !== 1 ) {

							console.error( 'THREE.STLLoader: Something isn\'t right with the normal of face number ' + faceCounter );

						} // each face have to own THREE valid vertices


						if ( vertexCountPerFace !== 3 ) {

							console.error( 'THREE.STLLoader: Something isn\'t right with the vertices of face number ' + faceCounter );

						}

						faceCounter ++;

					}

					const start = startVertex;
					const count = endVertex - startVertex;
					geometry.addGroup( start, count, groupCount );
					groupCount ++;

				}

				geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) );
				geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
				return geometry;

			}

			function ensureString( buffer ) {

				if ( typeof buffer !== 'string' ) {

					return THREE.LoaderUtils.decodeText( new Uint8Array( buffer ) );

				}

				return buffer;

			}

			function ensureBinary( buffer ) {

				if ( typeof buffer === 'string' ) {

					const array_buffer = new Uint8Array( buffer.length );

					for ( let i = 0; i < buffer.length; i ++ ) {

						array_buffer[ i ] = buffer.charCodeAt( i ) & 0xff; // implicitly assumes little-endian

					}

					return array_buffer.buffer || array_buffer;

				} else {

					return buffer;

				}

			} // start


			const binData = ensureBinary( data );
			return isBinary( binData ) ? parseBinary( binData ) : parseASCII( ensureString( data ) );

		}

	}

	THREE.STLLoader = STLLoader;

} )();

( function () {

	/**
 * Description: A THREE loader for PLY ASCII files (known as the Polygon
 * File Format or the Stanford Triangle Format).
 *
 * Limitations: ASCII decoding assumes file is UTF-8.
 *
 * Usage:
 *	const loader = new PLYLoader();
 *	loader.load('./models/ply/ascii/dolphins.ply', function (geometry) {
 *
 *		scene.add( new THREE.Mesh( geometry ) );
 *
 *	} );
 *
 * If the PLY file uses non standard property names, they can be mapped while
 * loading. For example, the following maps the properties
 * “diffuse_(red|green|blue)” in the file to standard color names.
 *
 * loader.setPropertyNameMapping( {
 *	diffuse_red: 'red',
 *	diffuse_green: 'green',
 *	diffuse_blue: 'blue'
 * } );
 *
 */

	class PLYLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );
			this.propertyNameMapping = {};

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const loader = new THREE.FileLoader( this.manager );
			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );
			loader.load( url, function ( text ) {

				try {

					onLoad( scope.parse( text ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		setPropertyNameMapping( mapping ) {

			this.propertyNameMapping = mapping;

		}

		parse( data ) {

			function parseHeader( data ) {

				const patternHeader = /ply([\s\S]*)end_header\r?\n/;
				let headerText = '';
				let headerLength = 0;
				const result = patternHeader.exec( data );

				if ( result !== null ) {

					headerText = result[ 1 ];
					headerLength = new Blob( [ result[ 0 ] ] ).size;

				}

				const header = {
					comments: [],
					elements: [],
					headerLength: headerLength,
					objInfo: ''
				};
				const lines = headerText.split( '\n' );
				let currentElement;

				function make_ply_element_property( propertValues, propertyNameMapping ) {

					const property = {
						type: propertValues[ 0 ]
					};

					if ( property.type === 'list' ) {

						property.name = propertValues[ 3 ];
						property.countType = propertValues[ 1 ];
						property.itemType = propertValues[ 2 ];

					} else {

						property.name = propertValues[ 1 ];

					}

					if ( property.name in propertyNameMapping ) {

						property.name = propertyNameMapping[ property.name ];

					}

					return property;

				}

				for ( let i = 0; i < lines.length; i ++ ) {

					let line = lines[ i ];
					line = line.trim();
					if ( line === '' ) continue;
					const lineValues = line.split( /\s+/ );
					const lineType = lineValues.shift();
					line = lineValues.join( ' ' );

					switch ( lineType ) {

						case 'format':
							header.format = lineValues[ 0 ];
							header.version = lineValues[ 1 ];
							break;

						case 'comment':
							header.comments.push( line );
							break;

						case 'element':
							if ( currentElement !== undefined ) {

								header.elements.push( currentElement );

							}

							currentElement = {};
							currentElement.name = lineValues[ 0 ];
							currentElement.count = parseInt( lineValues[ 1 ] );
							currentElement.properties = [];
							break;

						case 'property':
							currentElement.properties.push( make_ply_element_property( lineValues, scope.propertyNameMapping ) );
							break;

						case 'obj_info':
							header.objInfo = line;
							break;

						default:
							console.log( 'unhandled', lineType, lineValues );

					}

				}

				if ( currentElement !== undefined ) {

					header.elements.push( currentElement );

				}

				return header;

			}

			function parseASCIINumber( n, type ) {

				switch ( type ) {

					case 'char':
					case 'uchar':
					case 'short':
					case 'ushort':
					case 'int':
					case 'uint':
					case 'int8':
					case 'uint8':
					case 'int16':
					case 'uint16':
					case 'int32':
					case 'uint32':
						return parseInt( n );

					case 'float':
					case 'double':
					case 'float32':
					case 'float64':
						return parseFloat( n );

				}

			}

			function parseASCIIElement( properties, line ) {

				const values = line.split( /\s+/ );
				const element = {};

				for ( let i = 0; i < properties.length; i ++ ) {

					if ( properties[ i ].type === 'list' ) {

						const list = [];
						const n = parseASCIINumber( values.shift(), properties[ i ].countType );

						for ( let j = 0; j < n; j ++ ) {

							list.push( parseASCIINumber( values.shift(), properties[ i ].itemType ) );

						}

						element[ properties[ i ].name ] = list;

					} else {

						element[ properties[ i ].name ] = parseASCIINumber( values.shift(), properties[ i ].type );

					}

				}

				return element;

			}

			function parseASCII( data, header ) {

				// PLY ascii format specification, as per http://en.wikipedia.org/wiki/PLY_(file_format)
				const buffer = {
					indices: [],
					vertices: [],
					normals: [],
					uvs: [],
					faceVertexUvs: [],
					colors: []
				};
				let result;
				const patternBody = /end_header\s([\s\S]*)$/;
				let body = '';

				if ( ( result = patternBody.exec( data ) ) !== null ) {

					body = result[ 1 ];

				}

				const lines = body.split( '\n' );
				let currentElement = 0;
				let currentElementCount = 0;

				for ( let i = 0; i < lines.length; i ++ ) {

					let line = lines[ i ];
					line = line.trim();

					if ( line === '' ) {

						continue;

					}

					if ( currentElementCount >= header.elements[ currentElement ].count ) {

						currentElement ++;
						currentElementCount = 0;

					}

					const element = parseASCIIElement( header.elements[ currentElement ].properties, line );
					handleElement( buffer, header.elements[ currentElement ].name, element );
					currentElementCount ++;

				}

				return postProcess( buffer );

			}

			function postProcess( buffer ) {

				let geometry = new THREE.BufferGeometry(); // mandatory buffer data

				if ( buffer.indices.length > 0 ) {

					geometry.setIndex( buffer.indices );

				}

				geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( buffer.vertices, 3 ) ); // optional buffer data

				if ( buffer.normals.length > 0 ) {

					geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( buffer.normals, 3 ) );

				}

				if ( buffer.uvs.length > 0 ) {

					geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( buffer.uvs, 2 ) );

				}

				if ( buffer.colors.length > 0 ) {

					geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( buffer.colors, 3 ) );

				}

				if ( buffer.faceVertexUvs.length > 0 ) {

					geometry = geometry.toNonIndexed();
					geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( buffer.faceVertexUvs, 2 ) );

				}

				geometry.computeBoundingSphere();
				return geometry;

			}

			function handleElement( buffer, elementName, element ) {

				if ( elementName === 'vertex' ) {

					buffer.vertices.push( element.x, element.y, element.z );

					if ( 'nx' in element && 'ny' in element && 'nz' in element ) {

						buffer.normals.push( element.nx, element.ny, element.nz );

					}

					if ( 's' in element && 't' in element ) {

						buffer.uvs.push( element.s, element.t );

					}

					if ( 'red' in element && 'green' in element && 'blue' in element ) {

						buffer.colors.push( element.red / 255.0, element.green / 255.0, element.blue / 255.0 );

					}

				} else if ( elementName === 'face' ) {

					const vertex_indices = element.vertex_indices || element.vertex_index; // issue #9338

					const texcoord = element.texcoord;

					if ( vertex_indices.length === 3 ) {

						buffer.indices.push( vertex_indices[ 0 ], vertex_indices[ 1 ], vertex_indices[ 2 ] );

						if ( texcoord && texcoord.length === 6 ) {

							buffer.faceVertexUvs.push( texcoord[ 0 ], texcoord[ 1 ] );
							buffer.faceVertexUvs.push( texcoord[ 2 ], texcoord[ 3 ] );
							buffer.faceVertexUvs.push( texcoord[ 4 ], texcoord[ 5 ] );

						}

					} else if ( vertex_indices.length === 4 ) {

						buffer.indices.push( vertex_indices[ 0 ], vertex_indices[ 1 ], vertex_indices[ 3 ] );
						buffer.indices.push( vertex_indices[ 1 ], vertex_indices[ 2 ], vertex_indices[ 3 ] );

					}

				}

			}

			function binaryRead( dataview, at, type, little_endian ) {

				switch ( type ) {

					// corespondences for non-specific length types here match rply:
					case 'int8':
					case 'char':
						return [ dataview.getInt8( at ), 1 ];

					case 'uint8':
					case 'uchar':
						return [ dataview.getUint8( at ), 1 ];

					case 'int16':
					case 'short':
						return [ dataview.getInt16( at, little_endian ), 2 ];

					case 'uint16':
					case 'ushort':
						return [ dataview.getUint16( at, little_endian ), 2 ];

					case 'int32':
					case 'int':
						return [ dataview.getInt32( at, little_endian ), 4 ];

					case 'uint32':
					case 'uint':
						return [ dataview.getUint32( at, little_endian ), 4 ];

					case 'float32':
					case 'float':
						return [ dataview.getFloat32( at, little_endian ), 4 ];

					case 'float64':
					case 'double':
						return [ dataview.getFloat64( at, little_endian ), 8 ];

				}

			}

			function binaryReadElement( dataview, at, properties, little_endian ) {

				const element = {};
				let result,
					read = 0;

				for ( let i = 0; i < properties.length; i ++ ) {

					if ( properties[ i ].type === 'list' ) {

						const list = [];
						result = binaryRead( dataview, at + read, properties[ i ].countType, little_endian );
						const n = result[ 0 ];
						read += result[ 1 ];

						for ( let j = 0; j < n; j ++ ) {

							result = binaryRead( dataview, at + read, properties[ i ].itemType, little_endian );
							list.push( result[ 0 ] );
							read += result[ 1 ];

						}

						element[ properties[ i ].name ] = list;

					} else {

						result = binaryRead( dataview, at + read, properties[ i ].type, little_endian );
						element[ properties[ i ].name ] = result[ 0 ];
						read += result[ 1 ];

					}

				}

				return [ element, read ];

			}

			function parseBinary( data, header ) {

				const buffer = {
					indices: [],
					vertices: [],
					normals: [],
					uvs: [],
					faceVertexUvs: [],
					colors: []
				};
				const little_endian = header.format === 'binary_little_endian';
				const body = new DataView( data, header.headerLength );
				let result,
					loc = 0;

				for ( let currentElement = 0; currentElement < header.elements.length; currentElement ++ ) {

					for ( let currentElementCount = 0; currentElementCount < header.elements[ currentElement ].count; currentElementCount ++ ) {

						result = binaryReadElement( body, loc, header.elements[ currentElement ].properties, little_endian );
						loc += result[ 1 ];
						const element = result[ 0 ];
						handleElement( buffer, header.elements[ currentElement ].name, element );

					}

				}

				return postProcess( buffer );

			} //


			let geometry;
			const scope = this;

			if ( data instanceof ArrayBuffer ) {

				const text = THREE.LoaderUtils.decodeText( new Uint8Array( data ) );
				const header = parseHeader( text );
				geometry = header.format === 'ascii' ? parseASCII( text, header ) : parseBinary( data, header );

			} else {

				geometry = parseASCII( data, parseHeader( data ) );

			}

			return geometry;

		}

	}

	THREE.PLYLoader = PLYLoader;

} )();

( function () {

	/**
 *
 * 3D Manufacturing Format (3MF) specification: https://3mf.io/specification/
 *
 * The following features from the core specification are supported:
 *
 * - 3D Models
 * - Object Resources (Meshes and Components)
 * - Material Resources (Base Materials)
 *
 * 3MF Materials and Properties Extension are only partially supported.
 *
 * - Texture 2D
 * - Texture 2D Groups
 * - THREE.Color Groups (Vertex Colors)
 * - Metallic Display Properties (PBR)
 */

	class ThreeMFLoader extends THREE.Loader {

		constructor( manager ) {

			super( manager );
			this.availableExtensions = [];

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const loader = new THREE.FileLoader( scope.manager );
			loader.setPath( scope.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( scope.requestHeader );
			loader.setWithCredentials( scope.withCredentials );
			loader.load( url, function ( buffer ) {

				try {

					onLoad( scope.parse( buffer ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		parse( data ) {

			const scope = this;
			const textureLoader = new THREE.TextureLoader( this.manager );

			function loadDocument( data ) {

				let zip = null;
				let file = null;
				let relsName;
				let modelRelsName;
				const modelPartNames = [];
				const printTicketPartNames = [];
				const texturesPartNames = [];
				const otherPartNames = [];
				let modelRels;
				const modelParts = {};
				const printTicketParts = {};
				const texturesParts = {};
				const otherParts = {};

				try {

					zip = fflate.unzipSync( new Uint8Array( data ) ); // eslint-disable-line no-undef

				} catch ( e ) {

					if ( e instanceof ReferenceError ) {

						console.error( 'THREE.3MFLoader: fflate missing and file is compressed.' );
						return null;

					}

				}

				for ( file in zip ) {

					if ( file.match( /\_rels\/.rels$/ ) ) {

						relsName = file;

					} else if ( file.match( /3D\/_rels\/.*\.model\.rels$/ ) ) {

						modelRelsName = file;

					} else if ( file.match( /^3D\/.*\.model$/ ) ) {

						modelPartNames.push( file );

					} else if ( file.match( /^3D\/Metadata\/.*\.xml$/ ) ) {

						printTicketPartNames.push( file );

					} else if ( file.match( /^3D\/Textures?\/.*/ ) ) {

						texturesPartNames.push( file );

					} else if ( file.match( /^3D\/Other\/.*/ ) ) {

						otherPartNames.push( file );

					}

				} //


				const relsView = zip[ relsName ];
				const relsFileText = THREE.LoaderUtils.decodeText( relsView );
				const rels = parseRelsXml( relsFileText ); //

				if ( modelRelsName ) {

					const relsView = zip[ modelRelsName ];
					const relsFileText = THREE.LoaderUtils.decodeText( relsView );
					modelRels = parseRelsXml( relsFileText );

				} //


				for ( let i = 0; i < modelPartNames.length; i ++ ) {

					const modelPart = modelPartNames[ i ];
					const view = zip[ modelPart ];
					const fileText = THREE.LoaderUtils.decodeText( view );
					const xmlData = new DOMParser().parseFromString( fileText, 'application/xml' );

					if ( xmlData.documentElement.nodeName.toLowerCase() !== 'model' ) {

						console.error( 'THREE.3MFLoader: Error loading 3MF - no 3MF document found: ', modelPart );

					}

					const modelNode = xmlData.querySelector( 'model' );
					const extensions = {};

					for ( let i = 0; i < modelNode.attributes.length; i ++ ) {

						const attr = modelNode.attributes[ i ];

						if ( attr.name.match( /^xmlns:(.+)$/ ) ) {

							extensions[ attr.value ] = RegExp.$1;

						}

					}

					const modelData = parseModelNode( modelNode );
					modelData[ 'xml' ] = modelNode;

					if ( 0 < Object.keys( extensions ).length ) {

						modelData[ 'extensions' ] = extensions;

					}

					modelParts[ modelPart ] = modelData;

				} //


				for ( let i = 0; i < texturesPartNames.length; i ++ ) {

					const texturesPartName = texturesPartNames[ i ];
					texturesParts[ texturesPartName ] = zip[ texturesPartName ].buffer;

				}

				return {
					rels: rels,
					modelRels: modelRels,
					model: modelParts,
					printTicket: printTicketParts,
					texture: texturesParts,
					other: otherParts
				};

			}

			function parseRelsXml( relsFileText ) {

				const relationships = [];
				const relsXmlData = new DOMParser().parseFromString( relsFileText, 'application/xml' );
				const relsNodes = relsXmlData.querySelectorAll( 'Relationship' );

				for ( let i = 0; i < relsNodes.length; i ++ ) {

					const relsNode = relsNodes[ i ];
					const relationship = {
						target: relsNode.getAttribute( 'Target' ),
						//required
						id: relsNode.getAttribute( 'Id' ),
						//required
						type: relsNode.getAttribute( 'Type' ) //required

					};
					relationships.push( relationship );

				}

				return relationships;

			}

			function parseMetadataNodes( metadataNodes ) {

				const metadataData = {};

				for ( let i = 0; i < metadataNodes.length; i ++ ) {

					const metadataNode = metadataNodes[ i ];
					const name = metadataNode.getAttribute( 'name' );
					const validNames = [ 'Title', 'Designer', 'Description', 'Copyright', 'LicenseTerms', 'Rating', 'CreationDate', 'ModificationDate' ];

					if ( 0 <= validNames.indexOf( name ) ) {

						metadataData[ name ] = metadataNode.textContent;

					}

				}

				return metadataData;

			}

			function parseBasematerialsNode( basematerialsNode ) {

				const basematerialsData = {
					id: basematerialsNode.getAttribute( 'id' ),
					// required
					basematerials: []
				};
				const basematerialNodes = basematerialsNode.querySelectorAll( 'base' );

				for ( let i = 0; i < basematerialNodes.length; i ++ ) {

					const basematerialNode = basematerialNodes[ i ];
					const basematerialData = parseBasematerialNode( basematerialNode );
					basematerialData.index = i; // the order and count of the material nodes form an implicit 0-based index

					basematerialsData.basematerials.push( basematerialData );

				}

				return basematerialsData;

			}

			function parseTexture2DNode( texture2DNode ) {

				const texture2dData = {
					id: texture2DNode.getAttribute( 'id' ),
					// required
					path: texture2DNode.getAttribute( 'path' ),
					// required
					contenttype: texture2DNode.getAttribute( 'contenttype' ),
					// required
					tilestyleu: texture2DNode.getAttribute( 'tilestyleu' ),
					tilestylev: texture2DNode.getAttribute( 'tilestylev' ),
					filter: texture2DNode.getAttribute( 'filter' )
				};
				return texture2dData;

			}

			function parseTextures2DGroupNode( texture2DGroupNode ) {

				const texture2DGroupData = {
					id: texture2DGroupNode.getAttribute( 'id' ),
					// required
					texid: texture2DGroupNode.getAttribute( 'texid' ),
					// required
					displaypropertiesid: texture2DGroupNode.getAttribute( 'displaypropertiesid' )
				};
				const tex2coordNodes = texture2DGroupNode.querySelectorAll( 'tex2coord' );
				const uvs = [];

				for ( let i = 0; i < tex2coordNodes.length; i ++ ) {

					const tex2coordNode = tex2coordNodes[ i ];
					const u = tex2coordNode.getAttribute( 'u' );
					const v = tex2coordNode.getAttribute( 'v' );
					uvs.push( parseFloat( u ), parseFloat( v ) );

				}

				texture2DGroupData[ 'uvs' ] = new Float32Array( uvs );
				return texture2DGroupData;

			}

			function parseColorGroupNode( colorGroupNode ) {

				const colorGroupData = {
					id: colorGroupNode.getAttribute( 'id' ),
					// required
					displaypropertiesid: colorGroupNode.getAttribute( 'displaypropertiesid' )
				};
				const colorNodes = colorGroupNode.querySelectorAll( 'color' );
				const colors = [];
				const colorObject = new THREE.Color();

				for ( let i = 0; i < colorNodes.length; i ++ ) {

					const colorNode = colorNodes[ i ];
					const color = colorNode.getAttribute( 'color' );
					colorObject.setStyle( color.substring( 0, 7 ) );
					colorObject.convertSRGBToLinear(); // color is in sRGB

					colors.push( colorObject.r, colorObject.g, colorObject.b );

				}

				colorGroupData[ 'colors' ] = new Float32Array( colors );
				return colorGroupData;

			}

			function parseMetallicDisplaypropertiesNode( metallicDisplaypropetiesNode ) {

				const metallicDisplaypropertiesData = {
					id: metallicDisplaypropetiesNode.getAttribute( 'id' ) // required

				};
				const metallicNodes = metallicDisplaypropetiesNode.querySelectorAll( 'pbmetallic' );
				const metallicData = [];

				for ( let i = 0; i < metallicNodes.length; i ++ ) {

					const metallicNode = metallicNodes[ i ];
					metallicData.push( {
						name: metallicNode.getAttribute( 'name' ),
						// required
						metallicness: parseFloat( metallicNode.getAttribute( 'metallicness' ) ),
						// required
						roughness: parseFloat( metallicNode.getAttribute( 'roughness' ) ) // required

					} );

				}

				metallicDisplaypropertiesData.data = metallicData;
				return metallicDisplaypropertiesData;

			}

			function parseBasematerialNode( basematerialNode ) {

				const basematerialData = {};
				basematerialData[ 'name' ] = basematerialNode.getAttribute( 'name' ); // required

				basematerialData[ 'displaycolor' ] = basematerialNode.getAttribute( 'displaycolor' ); // required

				basematerialData[ 'displaypropertiesid' ] = basematerialNode.getAttribute( 'displaypropertiesid' );
				return basematerialData;

			}

			function parseMeshNode( meshNode ) {

				const meshData = {};
				const vertices = [];
				const vertexNodes = meshNode.querySelectorAll( 'vertices vertex' );

				for ( let i = 0; i < vertexNodes.length; i ++ ) {

					const vertexNode = vertexNodes[ i ];
					const x = vertexNode.getAttribute( 'x' );
					const y = vertexNode.getAttribute( 'y' );
					const z = vertexNode.getAttribute( 'z' );
					vertices.push( parseFloat( x ), parseFloat( y ), parseFloat( z ) );

				}

				meshData[ 'vertices' ] = new Float32Array( vertices );
				const triangleProperties = [];
				const triangles = [];
				const triangleNodes = meshNode.querySelectorAll( 'triangles triangle' );

				for ( let i = 0; i < triangleNodes.length; i ++ ) {

					const triangleNode = triangleNodes[ i ];
					const v1 = triangleNode.getAttribute( 'v1' );
					const v2 = triangleNode.getAttribute( 'v2' );
					const v3 = triangleNode.getAttribute( 'v3' );
					const p1 = triangleNode.getAttribute( 'p1' );
					const p2 = triangleNode.getAttribute( 'p2' );
					const p3 = triangleNode.getAttribute( 'p3' );
					const pid = triangleNode.getAttribute( 'pid' );
					const triangleProperty = {};
					triangleProperty[ 'v1' ] = parseInt( v1, 10 );
					triangleProperty[ 'v2' ] = parseInt( v2, 10 );
					triangleProperty[ 'v3' ] = parseInt( v3, 10 );
					triangles.push( triangleProperty[ 'v1' ], triangleProperty[ 'v2' ], triangleProperty[ 'v3' ] ); // optional

					if ( p1 ) {

						triangleProperty[ 'p1' ] = parseInt( p1, 10 );

					}

					if ( p2 ) {

						triangleProperty[ 'p2' ] = parseInt( p2, 10 );

					}

					if ( p3 ) {

						triangleProperty[ 'p3' ] = parseInt( p3, 10 );

					}

					if ( pid ) {

						triangleProperty[ 'pid' ] = pid;

					}

					if ( 0 < Object.keys( triangleProperty ).length ) {

						triangleProperties.push( triangleProperty );

					}

				}

				meshData[ 'triangleProperties' ] = triangleProperties;
				meshData[ 'triangles' ] = new Uint32Array( triangles );
				return meshData;

			}

			function parseComponentsNode( componentsNode ) {

				const components = [];
				const componentNodes = componentsNode.querySelectorAll( 'component' );

				for ( let i = 0; i < componentNodes.length; i ++ ) {

					const componentNode = componentNodes[ i ];
					const componentData = parseComponentNode( componentNode );
					components.push( componentData );

				}

				return components;

			}

			function parseComponentNode( componentNode ) {

				const componentData = {};
				componentData[ 'objectId' ] = componentNode.getAttribute( 'objectid' ); // required

				const transform = componentNode.getAttribute( 'transform' );

				if ( transform ) {

					componentData[ 'transform' ] = parseTransform( transform );

				}

				return componentData;

			}

			function parseTransform( transform ) {

				const t = [];
				transform.split( ' ' ).forEach( function ( s ) {

					t.push( parseFloat( s ) );

				} );
				const matrix = new THREE.Matrix4();
				matrix.set( t[ 0 ], t[ 3 ], t[ 6 ], t[ 9 ], t[ 1 ], t[ 4 ], t[ 7 ], t[ 10 ], t[ 2 ], t[ 5 ], t[ 8 ], t[ 11 ], 0.0, 0.0, 0.0, 1.0 );
				return matrix;

			}

			function parseObjectNode( objectNode ) {

				const objectData = {
					type: objectNode.getAttribute( 'type' )
				};
				const id = objectNode.getAttribute( 'id' );

				if ( id ) {

					objectData[ 'id' ] = id;

				}

				const pid = objectNode.getAttribute( 'pid' );

				if ( pid ) {

					objectData[ 'pid' ] = pid;

				}

				const pindex = objectNode.getAttribute( 'pindex' );

				if ( pindex ) {

					objectData[ 'pindex' ] = pindex;

				}

				const thumbnail = objectNode.getAttribute( 'thumbnail' );

				if ( thumbnail ) {

					objectData[ 'thumbnail' ] = thumbnail;

				}

				const partnumber = objectNode.getAttribute( 'partnumber' );

				if ( partnumber ) {

					objectData[ 'partnumber' ] = partnumber;

				}

				const name = objectNode.getAttribute( 'name' );

				if ( name ) {

					objectData[ 'name' ] = name;

				}

				const meshNode = objectNode.querySelector( 'mesh' );

				if ( meshNode ) {

					objectData[ 'mesh' ] = parseMeshNode( meshNode );

				}

				const componentsNode = objectNode.querySelector( 'components' );

				if ( componentsNode ) {

					objectData[ 'components' ] = parseComponentsNode( componentsNode );

				}

				return objectData;

			}

			function parseResourcesNode( resourcesNode ) {

				const resourcesData = {};
				resourcesData[ 'basematerials' ] = {};
				const basematerialsNodes = resourcesNode.querySelectorAll( 'basematerials' );

				for ( let i = 0; i < basematerialsNodes.length; i ++ ) {

					const basematerialsNode = basematerialsNodes[ i ];
					const basematerialsData = parseBasematerialsNode( basematerialsNode );
					resourcesData[ 'basematerials' ][ basematerialsData[ 'id' ] ] = basematerialsData;

				} //


				resourcesData[ 'texture2d' ] = {};
				const textures2DNodes = resourcesNode.querySelectorAll( 'texture2d' );

				for ( let i = 0; i < textures2DNodes.length; i ++ ) {

					const textures2DNode = textures2DNodes[ i ];
					const texture2DData = parseTexture2DNode( textures2DNode );
					resourcesData[ 'texture2d' ][ texture2DData[ 'id' ] ] = texture2DData;

				} //


				resourcesData[ 'colorgroup' ] = {};
				const colorGroupNodes = resourcesNode.querySelectorAll( 'colorgroup' );

				for ( let i = 0; i < colorGroupNodes.length; i ++ ) {

					const colorGroupNode = colorGroupNodes[ i ];
					const colorGroupData = parseColorGroupNode( colorGroupNode );
					resourcesData[ 'colorgroup' ][ colorGroupData[ 'id' ] ] = colorGroupData;

				} //


				resourcesData[ 'pbmetallicdisplayproperties' ] = {};
				const pbmetallicdisplaypropertiesNodes = resourcesNode.querySelectorAll( 'pbmetallicdisplayproperties' );

				for ( let i = 0; i < pbmetallicdisplaypropertiesNodes.length; i ++ ) {

					const pbmetallicdisplaypropertiesNode = pbmetallicdisplaypropertiesNodes[ i ];
					const pbmetallicdisplaypropertiesData = parseMetallicDisplaypropertiesNode( pbmetallicdisplaypropertiesNode );
					resourcesData[ 'pbmetallicdisplayproperties' ][ pbmetallicdisplaypropertiesData[ 'id' ] ] = pbmetallicdisplaypropertiesData;

				} //


				resourcesData[ 'texture2dgroup' ] = {};
				const textures2DGroupNodes = resourcesNode.querySelectorAll( 'texture2dgroup' );

				for ( let i = 0; i < textures2DGroupNodes.length; i ++ ) {

					const textures2DGroupNode = textures2DGroupNodes[ i ];
					const textures2DGroupData = parseTextures2DGroupNode( textures2DGroupNode );
					resourcesData[ 'texture2dgroup' ][ textures2DGroupData[ 'id' ] ] = textures2DGroupData;

				} //


				resourcesData[ 'object' ] = {};
				const objectNodes = resourcesNode.querySelectorAll( 'object' );

				for ( let i = 0; i < objectNodes.length; i ++ ) {

					const objectNode = objectNodes[ i ];
					const objectData = parseObjectNode( objectNode );
					resourcesData[ 'object' ][ objectData[ 'id' ] ] = objectData;

				}

				return resourcesData;

			}

			function parseBuildNode( buildNode ) {

				const buildData = [];
				const itemNodes = buildNode.querySelectorAll( 'item' );

				for ( let i = 0; i < itemNodes.length; i ++ ) {

					const itemNode = itemNodes[ i ];
					const buildItem = {
						objectId: itemNode.getAttribute( 'objectid' )
					};
					const transform = itemNode.getAttribute( 'transform' );

					if ( transform ) {

						buildItem[ 'transform' ] = parseTransform( transform );

					}

					buildData.push( buildItem );

				}

				return buildData;

			}

			function parseModelNode( modelNode ) {

				const modelData = {
					unit: modelNode.getAttribute( 'unit' ) || 'millimeter'
				};
				const metadataNodes = modelNode.querySelectorAll( 'metadata' );

				if ( metadataNodes ) {

					modelData[ 'metadata' ] = parseMetadataNodes( metadataNodes );

				}

				const resourcesNode = modelNode.querySelector( 'resources' );

				if ( resourcesNode ) {

					modelData[ 'resources' ] = parseResourcesNode( resourcesNode );

				}

				const buildNode = modelNode.querySelector( 'build' );

				if ( buildNode ) {

					modelData[ 'build' ] = parseBuildNode( buildNode );

				}

				return modelData;

			}

			function buildTexture( texture2dgroup, objects, modelData, textureData ) {

				const texid = texture2dgroup.texid;
				const texture2ds = modelData.resources.texture2d;
				const texture2d = texture2ds[ texid ];

				if ( texture2d ) {

					const data = textureData[ texture2d.path ];
					const type = texture2d.contenttype;
					const blob = new Blob( [ data ], {
						type: type
					} );
					const sourceURI = URL.createObjectURL( blob );
					const texture = textureLoader.load( sourceURI, function () {

						URL.revokeObjectURL( sourceURI );

					} );
					texture.encoding = THREE.sRGBEncoding; // texture parameters

					switch ( texture2d.tilestyleu ) {

						case 'wrap':
							texture.wrapS = THREE.RepeatWrapping;
							break;

						case 'mirror':
							texture.wrapS = THREE.MirroredRepeatWrapping;
							break;

						case 'none':
						case 'clamp':
							texture.wrapS = THREE.ClampToEdgeWrapping;
							break;

						default:
							texture.wrapS = THREE.RepeatWrapping;

					}

					switch ( texture2d.tilestylev ) {

						case 'wrap':
							texture.wrapT = THREE.RepeatWrapping;
							break;

						case 'mirror':
							texture.wrapT = THREE.MirroredRepeatWrapping;
							break;

						case 'none':
						case 'clamp':
							texture.wrapT = THREE.ClampToEdgeWrapping;
							break;

						default:
							texture.wrapT = THREE.RepeatWrapping;

					}

					switch ( texture2d.filter ) {

						case 'auto':
							texture.magFilter = THREE.LinearFilter;
							texture.minFilter = THREE.LinearMipmapLinearFilter;
							break;

						case 'linear':
							texture.magFilter = THREE.LinearFilter;
							texture.minFilter = THREE.LinearFilter;
							break;

						case 'nearest':
							texture.magFilter = THREE.NearestFilter;
							texture.minFilter = THREE.NearestFilter;
							break;

						default:
							texture.magFilter = THREE.LinearFilter;
							texture.minFilter = THREE.LinearMipmapLinearFilter;

					}

					return texture;

				} else {

					return null;

				}

			}

			function buildBasematerialsMeshes( basematerials, triangleProperties, meshData, objects, modelData, textureData, objectData ) {

				const objectPindex = objectData.pindex;
				const materialMap = {};

				for ( let i = 0, l = triangleProperties.length; i < l; i ++ ) {

					const triangleProperty = triangleProperties[ i ];
					const pindex = triangleProperty.p1 !== undefined ? triangleProperty.p1 : objectPindex;
					if ( materialMap[ pindex ] === undefined ) materialMap[ pindex ] = [];
					materialMap[ pindex ].push( triangleProperty );

				} //


				const keys = Object.keys( materialMap );
				const meshes = [];

				for ( let i = 0, l = keys.length; i < l; i ++ ) {

					const materialIndex = keys[ i ];
					const trianglePropertiesProps = materialMap[ materialIndex ];
					const basematerialData = basematerials.basematerials[ materialIndex ];
					const material = getBuild( basematerialData, objects, modelData, textureData, objectData, buildBasematerial ); //

					const geometry = new THREE.BufferGeometry();
					const positionData = [];
					const vertices = meshData.vertices;

					for ( let j = 0, jl = trianglePropertiesProps.length; j < jl; j ++ ) {

						const triangleProperty = trianglePropertiesProps[ j ];
						positionData.push( vertices[ triangleProperty.v1 * 3 + 0 ] );
						positionData.push( vertices[ triangleProperty.v1 * 3 + 1 ] );
						positionData.push( vertices[ triangleProperty.v1 * 3 + 2 ] );
						positionData.push( vertices[ triangleProperty.v2 * 3 + 0 ] );
						positionData.push( vertices[ triangleProperty.v2 * 3 + 1 ] );
						positionData.push( vertices[ triangleProperty.v2 * 3 + 2 ] );
						positionData.push( vertices[ triangleProperty.v3 * 3 + 0 ] );
						positionData.push( vertices[ triangleProperty.v3 * 3 + 1 ] );
						positionData.push( vertices[ triangleProperty.v3 * 3 + 2 ] );

					}

					geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positionData, 3 ) ); //

					const mesh = new THREE.Mesh( geometry, material );
					meshes.push( mesh );

				}

				return meshes;

			}

			function buildTexturedMesh( texture2dgroup, triangleProperties, meshData, objects, modelData, textureData, objectData ) {

				// geometry
				const geometry = new THREE.BufferGeometry();
				const positionData = [];
				const uvData = [];
				const vertices = meshData.vertices;
				const uvs = texture2dgroup.uvs;

				for ( let i = 0, l = triangleProperties.length; i < l; i ++ ) {

					const triangleProperty = triangleProperties[ i ];
					positionData.push( vertices[ triangleProperty.v1 * 3 + 0 ] );
					positionData.push( vertices[ triangleProperty.v1 * 3 + 1 ] );
					positionData.push( vertices[ triangleProperty.v1 * 3 + 2 ] );
					positionData.push( vertices[ triangleProperty.v2 * 3 + 0 ] );
					positionData.push( vertices[ triangleProperty.v2 * 3 + 1 ] );
					positionData.push( vertices[ triangleProperty.v2 * 3 + 2 ] );
					positionData.push( vertices[ triangleProperty.v3 * 3 + 0 ] );
					positionData.push( vertices[ triangleProperty.v3 * 3 + 1 ] );
					positionData.push( vertices[ triangleProperty.v3 * 3 + 2 ] ); //

					uvData.push( uvs[ triangleProperty.p1 * 2 + 0 ] );
					uvData.push( uvs[ triangleProperty.p1 * 2 + 1 ] );
					uvData.push( uvs[ triangleProperty.p2 * 2 + 0 ] );
					uvData.push( uvs[ triangleProperty.p2 * 2 + 1 ] );
					uvData.push( uvs[ triangleProperty.p3 * 2 + 0 ] );
					uvData.push( uvs[ triangleProperty.p3 * 2 + 1 ] );

				}

				geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positionData, 3 ) );
				geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvData, 2 ) ); // material

				const texture = getBuild( texture2dgroup, objects, modelData, textureData, objectData, buildTexture );
				const material = new THREE.MeshPhongMaterial( {
					map: texture,
					flatShading: true
				} ); // mesh

				const mesh = new THREE.Mesh( geometry, material );
				return mesh;

			}

			function buildVertexColorMesh( colorgroup, triangleProperties, meshData, objects, modelData, objectData ) {

				// geometry
				const geometry = new THREE.BufferGeometry();
				const positionData = [];
				const colorData = [];
				const vertices = meshData.vertices;
				const colors = colorgroup.colors;

				for ( let i = 0, l = triangleProperties.length; i < l; i ++ ) {

					const triangleProperty = triangleProperties[ i ];
					const v1 = triangleProperty.v1;
					const v2 = triangleProperty.v2;
					const v3 = triangleProperty.v3;
					positionData.push( vertices[ v1 * 3 + 0 ] );
					positionData.push( vertices[ v1 * 3 + 1 ] );
					positionData.push( vertices[ v1 * 3 + 2 ] );
					positionData.push( vertices[ v2 * 3 + 0 ] );
					positionData.push( vertices[ v2 * 3 + 1 ] );
					positionData.push( vertices[ v2 * 3 + 2 ] );
					positionData.push( vertices[ v3 * 3 + 0 ] );
					positionData.push( vertices[ v3 * 3 + 1 ] );
					positionData.push( vertices[ v3 * 3 + 2 ] ); //

					const p1 = triangleProperty.p1 !== undefined ? triangleProperty.p1 : objectData.pindex;
					const p2 = triangleProperty.p2 !== undefined ? triangleProperty.p2 : p1;
					const p3 = triangleProperty.p3 !== undefined ? triangleProperty.p3 : p1;
					colorData.push( colors[ p1 * 3 + 0 ] );
					colorData.push( colors[ p1 * 3 + 1 ] );
					colorData.push( colors[ p1 * 3 + 2 ] );
					colorData.push( colors[ p2 * 3 + 0 ] );
					colorData.push( colors[ p2 * 3 + 1 ] );
					colorData.push( colors[ p2 * 3 + 2 ] );
					colorData.push( colors[ p3 * 3 + 0 ] );
					colorData.push( colors[ p3 * 3 + 1 ] );
					colorData.push( colors[ p3 * 3 + 2 ] );

				}

				geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positionData, 3 ) );
				geometry.setAttribute( 'color', new THREE.Float32BufferAttribute( colorData, 3 ) ); // material

				const material = new THREE.MeshPhongMaterial( {
					vertexColors: true,
					flatShading: true
				} ); // mesh

				const mesh = new THREE.Mesh( geometry, material );
				return mesh;

			}

			function buildDefaultMesh( meshData ) {

				const geometry = new THREE.BufferGeometry();
				geometry.setIndex( new THREE.BufferAttribute( meshData[ 'triangles' ], 1 ) );
				geometry.setAttribute( 'position', new THREE.BufferAttribute( meshData[ 'vertices' ], 3 ) );
				const material = new THREE.MeshPhongMaterial( {
					color: 0xaaaaff,
					flatShading: true
				} );
				const mesh = new THREE.Mesh( geometry, material );
				return mesh;

			}

			function buildMeshes( resourceMap, meshData, objects, modelData, textureData, objectData ) {

				const keys = Object.keys( resourceMap );
				const meshes = [];

				for ( let i = 0, il = keys.length; i < il; i ++ ) {

					const resourceId = keys[ i ];
					const triangleProperties = resourceMap[ resourceId ];
					const resourceType = getResourceType( resourceId, modelData );

					switch ( resourceType ) {

						case 'material':
							const basematerials = modelData.resources.basematerials[ resourceId ];
							const newMeshes = buildBasematerialsMeshes( basematerials, triangleProperties, meshData, objects, modelData, textureData, objectData );

							for ( let j = 0, jl = newMeshes.length; j < jl; j ++ ) {

								meshes.push( newMeshes[ j ] );

							}

							break;

						case 'texture':
							const texture2dgroup = modelData.resources.texture2dgroup[ resourceId ];
							meshes.push( buildTexturedMesh( texture2dgroup, triangleProperties, meshData, objects, modelData, textureData, objectData ) );
							break;

						case 'vertexColors':
							const colorgroup = modelData.resources.colorgroup[ resourceId ];
							meshes.push( buildVertexColorMesh( colorgroup, triangleProperties, meshData, objects, modelData, objectData ) );
							break;

						case 'default':
							meshes.push( buildDefaultMesh( meshData ) );
							break;

						default:
							console.error( 'THREE.3MFLoader: Unsupported resource type.' );

					}

				}

				return meshes;

			}

			function getResourceType( pid, modelData ) {

				if ( modelData.resources.texture2dgroup[ pid ] !== undefined ) {

					return 'texture';

				} else if ( modelData.resources.basematerials[ pid ] !== undefined ) {

					return 'material';

				} else if ( modelData.resources.colorgroup[ pid ] !== undefined ) {

					return 'vertexColors';

				} else if ( pid === 'default' ) {

					return 'default';

				} else {

					return undefined;

				}

			}

			function analyzeObject( modelData, meshData, objectData ) {

				const resourceMap = {};
				const triangleProperties = meshData[ 'triangleProperties' ];
				const objectPid = objectData.pid;

				for ( let i = 0, l = triangleProperties.length; i < l; i ++ ) {

					const triangleProperty = triangleProperties[ i ];
					let pid = triangleProperty.pid !== undefined ? triangleProperty.pid : objectPid;
					if ( pid === undefined ) pid = 'default';
					if ( resourceMap[ pid ] === undefined ) resourceMap[ pid ] = [];
					resourceMap[ pid ].push( triangleProperty );

				}

				return resourceMap;

			}

			function buildGroup( meshData, objects, modelData, textureData, objectData ) {

				const group = new THREE.Group();
				const resourceMap = analyzeObject( modelData, meshData, objectData );
				const meshes = buildMeshes( resourceMap, meshData, objects, modelData, textureData, objectData );

				for ( let i = 0, l = meshes.length; i < l; i ++ ) {

					group.add( meshes[ i ] );

				}

				return group;

			}

			function applyExtensions( extensions, meshData, modelXml ) {

				if ( ! extensions ) {

					return;

				}

				const availableExtensions = [];
				const keys = Object.keys( extensions );

				for ( let i = 0; i < keys.length; i ++ ) {

					const ns = keys[ i ];

					for ( let j = 0; j < scope.availableExtensions.length; j ++ ) {

						const extension = scope.availableExtensions[ j ];

						if ( extension.ns === ns ) {

							availableExtensions.push( extension );

						}

					}

				}

				for ( let i = 0; i < availableExtensions.length; i ++ ) {

					const extension = availableExtensions[ i ];
					extension.apply( modelXml, extensions[ extension[ 'ns' ] ], meshData );

				}

			}

			function getBuild( data, objects, modelData, textureData, objectData, builder ) {

				if ( data.build !== undefined ) return data.build;
				data.build = builder( data, objects, modelData, textureData, objectData );
				return data.build;

			}

			function buildBasematerial( materialData, objects, modelData ) {

				let material;
				const displaypropertiesid = materialData.displaypropertiesid;
				const pbmetallicdisplayproperties = modelData.resources.pbmetallicdisplayproperties;

				if ( displaypropertiesid !== null && pbmetallicdisplayproperties[ displaypropertiesid ] !== undefined ) {

					// metallic display property, use StandardMaterial
					const pbmetallicdisplayproperty = pbmetallicdisplayproperties[ displaypropertiesid ];
					const metallicData = pbmetallicdisplayproperty.data[ materialData.index ];
					material = new THREE.MeshStandardMaterial( {
						flatShading: true,
						roughness: metallicData.roughness,
						metalness: metallicData.metallicness
					} );

				} else {

					// otherwise use PhongMaterial
					material = new THREE.MeshPhongMaterial( {
						flatShading: true
					} );

				}

				material.name = materialData.name; // displaycolor MUST be specified with a value of a 6 or 8 digit hexadecimal number, e.g. "#RRGGBB" or "#RRGGBBAA"

				const displaycolor = materialData.displaycolor;
				const color = displaycolor.substring( 0, 7 );
				material.color.setStyle( color );
				material.color.convertSRGBToLinear(); // displaycolor is in sRGB
				// process alpha if set

				if ( displaycolor.length === 9 ) {

					material.opacity = parseInt( displaycolor.charAt( 7 ) + displaycolor.charAt( 8 ), 16 ) / 255;

				}

				return material;

			}

			function buildComposite( compositeData, objects, modelData, textureData ) {

				const composite = new THREE.Group();

				for ( let j = 0; j < compositeData.length; j ++ ) {

					const component = compositeData[ j ];
					let build = objects[ component.objectId ];

					if ( build === undefined ) {

						buildObject( component.objectId, objects, modelData, textureData );
						build = objects[ component.objectId ];

					}

					const object3D = build.clone(); // apply component transform

					const transform = component.transform;

					if ( transform ) {

						object3D.applyMatrix4( transform );

					}

					composite.add( object3D );

				}

				return composite;

			}

			function buildObject( objectId, objects, modelData, textureData ) {

				const objectData = modelData[ 'resources' ][ 'object' ][ objectId ];

				if ( objectData[ 'mesh' ] ) {

					const meshData = objectData[ 'mesh' ];
					const extensions = modelData[ 'extensions' ];
					const modelXml = modelData[ 'xml' ];
					applyExtensions( extensions, meshData, modelXml );
					objects[ objectData.id ] = getBuild( meshData, objects, modelData, textureData, objectData, buildGroup );

				} else {

					const compositeData = objectData[ 'components' ];
					objects[ objectData.id ] = getBuild( compositeData, objects, modelData, textureData, objectData, buildComposite );

				}

			}

			function buildObjects( data3mf ) {

				const modelsData = data3mf.model;
				const modelRels = data3mf.modelRels;
				const objects = {};
				const modelsKeys = Object.keys( modelsData );
				const textureData = {}; // evaluate model relationships to textures

				if ( modelRels ) {

					for ( let i = 0, l = modelRels.length; i < l; i ++ ) {

						const modelRel = modelRels[ i ];
						const textureKey = modelRel.target.substring( 1 );

						if ( data3mf.texture[ textureKey ] ) {

							textureData[ modelRel.target ] = data3mf.texture[ textureKey ];

						}

					}

				} // start build


				for ( let i = 0; i < modelsKeys.length; i ++ ) {

					const modelsKey = modelsKeys[ i ];
					const modelData = modelsData[ modelsKey ];
					const objectIds = Object.keys( modelData[ 'resources' ][ 'object' ] );

					for ( let j = 0; j < objectIds.length; j ++ ) {

						const objectId = objectIds[ j ];
						buildObject( objectId, objects, modelData, textureData );

					}

				}

				return objects;

			}

			function fetch3DModelPart( rels ) {

				for ( let i = 0; i < rels.length; i ++ ) {

					const rel = rels[ i ];
					const extension = rel.target.split( '.' ).pop();
					if ( extension.toLowerCase() === 'model' ) return rel;

				}

			}

			function build( objects, data3mf ) {

				const group = new THREE.Group();
				const relationship = fetch3DModelPart( data3mf[ 'rels' ] );
				const buildData = data3mf.model[ relationship[ 'target' ].substring( 1 ) ][ 'build' ];

				for ( let i = 0; i < buildData.length; i ++ ) {

					const buildItem = buildData[ i ];
					const object3D = objects[ buildItem[ 'objectId' ] ]; // apply transform

					const transform = buildItem[ 'transform' ];

					if ( transform ) {

						object3D.applyMatrix4( transform );

					}

					group.add( object3D );

				}

				return group;

			}

			const data3mf = loadDocument( data );
			const objects = buildObjects( data3mf );
			return build( objects, data3mf );

		}

		addExtension( extension ) {

			this.availableExtensions.push( extension );

		}

	}

	THREE.ThreeMFLoader = ThreeMFLoader;

} )();

( function () {

	const _normalData = [[ - 0.525731, 0.000000, 0.850651 ], [ - 0.442863, 0.238856, 0.864188 ], [ - 0.295242, 0.000000, 0.955423 ], [ - 0.309017, 0.500000, 0.809017 ], [ - 0.162460, 0.262866, 0.951056 ], [ 0.000000, 0.000000, 1.000000 ], [ 0.000000, 0.850651, 0.525731 ], [ - 0.147621, 0.716567, 0.681718 ], [ 0.147621, 0.716567, 0.681718 ], [ 0.000000, 0.525731, 0.850651 ], [ 0.309017, 0.500000, 0.809017 ], [ 0.525731, 0.000000, 0.850651 ], [ 0.295242, 0.000000, 0.955423 ], [ 0.442863, 0.238856, 0.864188 ], [ 0.162460, 0.262866, 0.951056 ], [ - 0.681718, 0.147621, 0.716567 ], [ - 0.809017, 0.309017, 0.500000 ], [ - 0.587785, 0.425325, 0.688191 ], [ - 0.850651, 0.525731, 0.000000 ], [ - 0.864188, 0.442863, 0.238856 ], [ - 0.716567, 0.681718, 0.147621 ], [ - 0.688191, 0.587785, 0.425325 ], [ - 0.500000, 0.809017, 0.309017 ], [ - 0.238856, 0.864188, 0.442863 ], [ - 0.425325, 0.688191, 0.587785 ], [ - 0.716567, 0.681718, - 0.147621 ], [ - 0.500000, 0.809017, - 0.309017 ], [ - 0.525731, 0.850651, 0.000000 ], [ 0.000000, 0.850651, - 0.525731 ], [ - 0.238856, 0.864188, - 0.442863 ], [ 0.000000, 0.955423, - 0.295242 ], [ - 0.262866, 0.951056, - 0.162460 ], [ 0.000000, 1.000000, 0.000000 ], [ 0.000000, 0.955423, 0.295242 ], [ - 0.262866, 0.951056, 0.162460 ], [ 0.238856, 0.864188, 0.442863 ], [ 0.262866, 0.951056, 0.162460 ], [ 0.500000, 0.809017, 0.309017 ], [ 0.238856, 0.864188, - 0.442863 ], [ 0.262866, 0.951056, - 0.162460 ], [ 0.500000, 0.809017, - 0.309017 ], [ 0.850651, 0.525731, 0.000000 ], [ 0.716567, 0.681718, 0.147621 ], [ 0.716567, 0.681718, - 0.147621 ], [ 0.525731, 0.850651, 0.000000 ], [ 0.425325, 0.688191, 0.587785 ], [ 0.864188, 0.442863, 0.238856 ], [ 0.688191, 0.587785, 0.425325 ], [ 0.809017, 0.309017, 0.500000 ], [ 0.681718, 0.147621, 0.716567 ], [ 0.587785, 0.425325, 0.688191 ], [ 0.955423, 0.295242, 0.000000 ], [ 1.000000, 0.000000, 0.000000 ], [ 0.951056, 0.162460, 0.262866 ], [ 0.850651, - 0.525731, 0.000000 ], [ 0.955423, - 0.295242, 0.000000 ], [ 0.864188, - 0.442863, 0.238856 ], [ 0.951056, - 0.162460, 0.262866 ], [ 0.809017, - 0.309017, 0.500000 ], [ 0.681718, - 0.147621, 0.716567 ], [ 0.850651, 0.000000, 0.525731 ], [ 0.864188, 0.442863, - 0.238856 ], [ 0.809017, 0.309017, - 0.500000 ], [ 0.951056, 0.162460, - 0.262866 ], [ 0.525731, 0.000000, - 0.850651 ], [ 0.681718, 0.147621, - 0.716567 ], [ 0.681718, - 0.147621, - 0.716567 ], [ 0.850651, 0.000000, - 0.525731 ], [ 0.809017, - 0.309017, - 0.500000 ], [ 0.864188, - 0.442863, - 0.238856 ], [ 0.951056, - 0.162460, - 0.262866 ], [ 0.147621, 0.716567, - 0.681718 ], [ 0.309017, 0.500000, - 0.809017 ], [ 0.425325, 0.688191, - 0.587785 ], [ 0.442863, 0.238856, - 0.864188 ], [ 0.587785, 0.425325, - 0.688191 ], [ 0.688191, 0.587785, - 0.425325 ], [ - 0.147621, 0.716567, - 0.681718 ], [ - 0.309017, 0.500000, - 0.809017 ], [ 0.000000, 0.525731, - 0.850651 ], [ - 0.525731, 0.000000, - 0.850651 ], [ - 0.442863, 0.238856, - 0.864188 ], [ - 0.295242, 0.000000, - 0.955423 ], [ - 0.162460, 0.262866, - 0.951056 ], [ 0.000000, 0.000000, - 1.000000 ], [ 0.295242, 0.000000, - 0.955423 ], [ 0.162460, 0.262866, - 0.951056 ], [ - 0.442863, - 0.238856, - 0.864188 ], [ - 0.309017, - 0.500000, - 0.809017 ], [ - 0.162460, - 0.262866, - 0.951056 ], [ 0.000000, - 0.850651, - 0.525731 ], [ - 0.147621, - 0.716567, - 0.681718 ], [ 0.147621, - 0.716567, - 0.681718 ], [ 0.000000, - 0.525731, - 0.850651 ], [ 0.309017, - 0.500000, - 0.809017 ], [ 0.442863, - 0.238856, - 0.864188 ], [ 0.162460, - 0.262866, - 0.951056 ], [ 0.238856, - 0.864188, - 0.442863 ], [ 0.500000, - 0.809017, - 0.309017 ], [ 0.425325, - 0.688191, - 0.587785 ], [ 0.716567, - 0.681718, - 0.147621 ], [ 0.688191, - 0.587785, - 0.425325 ], [ 0.587785, - 0.425325, - 0.688191 ], [ 0.000000, - 0.955423, - 0.295242 ], [ 0.000000, - 1.000000, 0.000000 ], [ 0.262866, - 0.951056, - 0.162460 ], [ 0.000000, - 0.850651, 0.525731 ], [ 0.000000, - 0.955423, 0.295242 ], [ 0.238856, - 0.864188, 0.442863 ], [ 0.262866, - 0.951056, 0.162460 ], [ 0.500000, - 0.809017, 0.309017 ], [ 0.716567, - 0.681718, 0.147621 ], [ 0.525731, - 0.850651, 0.000000 ], [ - 0.238856, - 0.864188, - 0.442863 ], [ - 0.500000, - 0.809017, - 0.309017 ], [ - 0.262866, - 0.951056, - 0.162460 ], [ - 0.850651, - 0.525731, 0.000000 ], [ - 0.716567, - 0.681718, - 0.147621 ], [ - 0.716567, - 0.681718, 0.147621 ], [ - 0.525731, - 0.850651, 0.000000 ], [ - 0.500000, - 0.809017, 0.309017 ], [ - 0.238856, - 0.864188, 0.442863 ], [ - 0.262866, - 0.951056, 0.162460 ], [ - 0.864188, - 0.442863, 0.238856 ], [ - 0.809017, - 0.309017, 0.500000 ], [ - 0.688191, - 0.587785, 0.425325 ], [ - 0.681718, - 0.147621, 0.716567 ], [ - 0.442863, - 0.238856, 0.864188 ], [ - 0.587785, - 0.425325, 0.688191 ], [ - 0.309017, - 0.500000, 0.809017 ], [ - 0.147621, - 0.716567, 0.681718 ], [ - 0.425325, - 0.688191, 0.587785 ], [ - 0.162460, - 0.262866, 0.951056 ], [ 0.442863, - 0.238856, 0.864188 ], [ 0.162460, - 0.262866, 0.951056 ], [ 0.309017, - 0.500000, 0.809017 ], [ 0.147621, - 0.716567, 0.681718 ], [ 0.000000, - 0.525731, 0.850651 ], [ 0.425325, - 0.688191, 0.587785 ], [ 0.587785, - 0.425325, 0.688191 ], [ 0.688191, - 0.587785, 0.425325 ], [ - 0.955423, 0.295242, 0.000000 ], [ - 0.951056, 0.162460, 0.262866 ], [ - 1.000000, 0.000000, 0.000000 ], [ - 0.850651, 0.000000, 0.525731 ], [ - 0.955423, - 0.295242, 0.000000 ], [ - 0.951056, - 0.162460, 0.262866 ], [ - 0.864188, 0.442863, - 0.238856 ], [ - 0.951056, 0.162460, - 0.262866 ], [ - 0.809017, 0.309017, - 0.500000 ], [ - 0.864188, - 0.442863, - 0.238856 ], [ - 0.951056, - 0.162460, - 0.262866 ], [ - 0.809017, - 0.309017, - 0.500000 ], [ - 0.681718, 0.147621, - 0.716567 ], [ - 0.681718, - 0.147621, - 0.716567 ], [ - 0.850651, 0.000000, - 0.525731 ], [ - 0.688191, 0.587785, - 0.425325 ], [ - 0.587785, 0.425325, - 0.688191 ], [ - 0.425325, 0.688191, - 0.587785 ], [ - 0.425325, - 0.688191, - 0.587785 ], [ - 0.587785, - 0.425325, - 0.688191 ], [ - 0.688191, - 0.587785, - 0.425325 ]];

	class MD2Loader extends THREE.Loader {

		constructor( manager ) {

			super( manager );

		}

		load( url, onLoad, onProgress, onError ) {

			const scope = this;
			const loader = new THREE.FileLoader( scope.manager );
			loader.setPath( scope.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( scope.requestHeader );
			loader.setWithCredentials( scope.withCredentials );
			loader.load( url, function ( buffer ) {

				try {

					onLoad( scope.parse( buffer ) );

				} catch ( e ) {

					if ( onError ) {

						onError( e );

					} else {

						console.error( e );

					}

					scope.manager.itemError( url );

				}

			}, onProgress, onError );

		}

		parse( buffer ) {

			const data = new DataView( buffer ); // http://tfc.duke.free.fr/coding/md2-specs-en.html

			const header = {};
			const headerNames = [ 'ident', 'version', 'skinwidth', 'skinheight', 'framesize', 'num_skins', 'num_vertices', 'num_st', 'num_tris', 'num_glcmds', 'num_frames', 'offset_skins', 'offset_st', 'offset_tris', 'offset_frames', 'offset_glcmds', 'offset_end' ];

			for ( let i = 0; i < headerNames.length; i ++ ) {

				header[ headerNames[ i ] ] = data.getInt32( i * 4, true );

			}

			if ( header.ident !== 844121161 || header.version !== 8 ) {

				console.error( 'Not a valid MD2 file' );
				return;

			}

			if ( header.offset_end !== data.byteLength ) {

				console.error( 'Corrupted MD2 file' );
				return;

			} //


			const geometry = new THREE.BufferGeometry(); // uvs

			const uvsTemp = [];
			let offset = header.offset_st;

			for ( let i = 0, l = header.num_st; i < l; i ++ ) {

				const u = data.getInt16( offset + 0, true );
				const v = data.getInt16( offset + 2, true );
				uvsTemp.push( u / header.skinwidth, 1 - v / header.skinheight );
				offset += 4;

			} // triangles


			offset = header.offset_tris;
			const vertexIndices = [];
			const uvIndices = [];

			for ( let i = 0, l = header.num_tris; i < l; i ++ ) {

				vertexIndices.push( data.getUint16( offset + 0, true ), data.getUint16( offset + 2, true ), data.getUint16( offset + 4, true ) );
				uvIndices.push( data.getUint16( offset + 6, true ), data.getUint16( offset + 8, true ), data.getUint16( offset + 10, true ) );
				offset += 12;

			} // frames


			const translation = new THREE.Vector3();
			const scale = new THREE.Vector3();
			const frames = [];
			offset = header.offset_frames;

			for ( let i = 0, l = header.num_frames; i < l; i ++ ) {

				scale.set( data.getFloat32( offset + 0, true ), data.getFloat32( offset + 4, true ), data.getFloat32( offset + 8, true ) );
				translation.set( data.getFloat32( offset + 12, true ), data.getFloat32( offset + 16, true ), data.getFloat32( offset + 20, true ) );
				offset += 24;
				const string = [];

				for ( let j = 0; j < 16; j ++ ) {

					const character = data.getUint8( offset + j, true );
					if ( character === 0 ) break;
					string[ j ] = character;

				}

				const frame = {
					name: String.fromCharCode.apply( null, string ),
					vertices: [],
					normals: []
				};
				offset += 16;

				for ( let j = 0; j < header.num_vertices; j ++ ) {

					let x = data.getUint8( offset ++, true );
					let y = data.getUint8( offset ++, true );
					let z = data.getUint8( offset ++, true );

					const n = _normalData[ data.getUint8( offset ++, true ) ];

					x = x * scale.x + translation.x;
					y = y * scale.y + translation.y;
					z = z * scale.z + translation.z;
					frame.vertices.push( x, z, y ); // convert to Y-up

					frame.normals.push( n[ 0 ], n[ 2 ], n[ 1 ] ); // convert to Y-up

				}

				frames.push( frame );

			} // static


			const positions = [];
			const normals = [];
			const uvs = [];
			const verticesTemp = frames[ 0 ].vertices;
			const normalsTemp = frames[ 0 ].normals;

			for ( let i = 0, l = vertexIndices.length; i < l; i ++ ) {

				const vertexIndex = vertexIndices[ i ];
				let stride = vertexIndex * 3; //

				const x = verticesTemp[ stride ];
				const y = verticesTemp[ stride + 1 ];
				const z = verticesTemp[ stride + 2 ];
				positions.push( x, y, z ); //

				const nx = normalsTemp[ stride ];
				const ny = normalsTemp[ stride + 1 ];
				const nz = normalsTemp[ stride + 2 ];
				normals.push( nx, ny, nz ); //

				const uvIndex = uvIndices[ i ];
				stride = uvIndex * 2;
				const u = uvsTemp[ stride ];
				const v = uvsTemp[ stride + 1 ];
				uvs.push( u, v );

			}

			geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
			geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
			geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) ); // animation

			const morphPositions = [];
			const morphNormals = [];

			for ( let i = 0, l = frames.length; i < l; i ++ ) {

				const frame = frames[ i ];
				const attributeName = frame.name;

				if ( frame.vertices.length > 0 ) {

					const positions = [];

					for ( let j = 0, jl = vertexIndices.length; j < jl; j ++ ) {

						const vertexIndex = vertexIndices[ j ];
						const stride = vertexIndex * 3;
						const x = frame.vertices[ stride ];
						const y = frame.vertices[ stride + 1 ];
						const z = frame.vertices[ stride + 2 ];
						positions.push( x, y, z );

					}

					const positionAttribute = new THREE.Float32BufferAttribute( positions, 3 );
					positionAttribute.name = attributeName;
					morphPositions.push( positionAttribute );

				}

				if ( frame.normals.length > 0 ) {

					const normals = [];

					for ( let j = 0, jl = vertexIndices.length; j < jl; j ++ ) {

						const vertexIndex = vertexIndices[ j ];
						const stride = vertexIndex * 3;
						const nx = frame.normals[ stride ];
						const ny = frame.normals[ stride + 1 ];
						const nz = frame.normals[ stride + 2 ];
						normals.push( nx, ny, nz );

					}

					const normalAttribute = new THREE.Float32BufferAttribute( normals, 3 );
					normalAttribute.name = attributeName;
					morphNormals.push( normalAttribute );

				}

			}

			geometry.morphAttributes.position = morphPositions;
			geometry.morphAttributes.normal = morphNormals;
			geometry.morphTargetsRelative = false;
			geometry.animations = THREE.AnimationClip.CreateClipsFromMorphTargetSequences( frames, 10 );
			return geometry;

		}

	}

	THREE.MD2Loader = MD2Loader;

} )();

	return THREE;
})(window.THREE);

const MODEL_EXT = ['obj', 'fbx', 'gltf', 'glb', 'dae', '3ds', 'stl', 'ply', '3mf', 'md2', 'mdl'];
const RESOURCE_EXT = ['mtl', 'bin', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'gif', 'webp', 'lmp'];

// ---------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------

const TEXTS = {
	en: {
		action: '3D model (OBJ, FBX, glTF, DAE, 3DS, STL, PLY, MDL…)', action_desc: 'Import geometry, textures, skeleton and animations from a 3D model file',
		title: 'Import 3D model', files: 'Files', size: 'Size', size_fit: 'Fit to a height', size_keep: 'Keep the size of the file (× factor)', height: 'Height (px)', factor: 'Factor',
		ground: 'Stand it on the ground, centred', up: 'Up axis', up_auto: 'Automatic (Z for 3DS, STL, 3MF)', up_y: 'Y up', up_z: 'Z up (turn it upright)', anims: 'Animations', textures: 'Textures and colours', quads: 'Join triangles into quads', skin: 'Skeleton',
		skin_auto: 'Automatic', skin_groups: 'Bone groups (parts move rigidly)', skin_armature: 'Armature with vertex weights (smooth skin, Blockbench 5)', fps: 'Animation frames per second',
		target: 'Into', target_new: 'A new project (Generic model)', target_current: 'The open project',
		hint: 'Select the textures, .mtl and .bin files together with the model if Blockbench cannot read the folder of the model. Morph (vertex) animations cannot be shown in Blockbench: their first frame is imported.',
		busy: 'Importing…', done: 'Imported %n: % meshes, % bones, % animations', failed: 'Import failed', unknown: 'Not a model file this importer knows',
		no_mesh: 'There is no geometry in this file', morph: 'This model has morph (vertex) animations: Blockbench cannot play them, the first frame is imported',
		mdl_seqgroup: 'Some animations of this model are in separate files (%01.mdl…): select them too to import them',
		mdl_textures: 'The textures of this model are in a separate file (%t.mdl): select it too',
		quake_palette: 'Quake MDL: no palette.lmp found next to the model, the skin is shown in grey (select palette.lmp to get the colours)',
		source_mdl: 'This is a Source engine MDL (version %): only Half-Life (GoldSrc) and Quake MDL can be read. Export it to SMD/FBX with Crowbar first.',
		too_big: 'This model is very big (% triangles): Blockbench may be slow with it',
	},
	ru: {
		action: '3D-модель (OBJ, FBX, glTF, DAE, 3DS, STL, PLY, MDL…)', action_desc: 'Импорт геометрии, текстур, скелета и анимаций из файла 3D-модели',
		title: 'Импорт 3D-модели', files: 'Файлы', size: 'Размер', size_fit: 'Подогнать по высоте', size_keep: 'Как в файле (× множитель)', height: 'Высота (px)', factor: 'Множитель',
		ground: 'Поставить на землю по центру', up: 'Ось вверх', up_auto: 'Автоматически (Z для 3DS, STL, 3MF)', up_y: 'Y вверх', up_z: 'Z вверх (поставить вертикально)', anims: 'Анимации', textures: 'Текстуры и цвета', quads: 'Объединять треугольники в квадраты', skin: 'Скелет',
		skin_auto: 'Автоматически', skin_groups: 'Группы-кости (части двигаются целиком)', skin_armature: 'Арматура с весами вершин (плавная кожа, Blockbench 5)', fps: 'Кадров анимации в секунду',
		target: 'Куда', target_new: 'В новый проект (Generic model)', target_current: 'В открытый проект',
		hint: 'Если Blockbench не может прочитать папку модели, выберите текстуры, .mtl и .bin вместе с моделью. Морф-анимации (анимация вершин) Blockbench не показывает: берётся первый кадр.',
		busy: 'Импорт…', done: 'Импортировано %n: мешей %, костей %, анимаций %', failed: 'Импорт не удался', unknown: 'Этот файл не похож на модель, которую умеет читать импорт',
		no_mesh: 'В этом файле нет геометрии', morph: 'У модели морф-анимации (анимация вершин): Blockbench их не проигрывает, взят первый кадр',
		mdl_seqgroup: 'Часть анимаций этой модели лежит в отдельных файлах (%01.mdl…): выберите их тоже, чтобы импортировать',
		mdl_textures: 'Текстуры этой модели лежат в отдельном файле (%t.mdl): выберите его тоже',
		quake_palette: 'Quake MDL: рядом с моделью нет palette.lmp, скин будет серым (выберите palette.lmp, чтобы получить цвета)',
		source_mdl: 'Это MDL движка Source (версия %): читаются только MDL из Half-Life (GoldSrc) и Quake. Сначала переведите его в SMD/FBX через Crowbar.',
		too_big: 'Модель очень большая (треугольников: %): Blockbench может с ней тормозить',
	},
};
const tr = key => {
	const lang = (typeof Language != 'undefined' && Language.code) || 'en';
	return (TEXTS[lang] && TEXTS[lang][key]) || TEXTS.en[key] || key;
};
const fill = (text, ...values) => { let i = 0; return text.replace(/%n|%/g, m => m == '%n' ? values.shift() : (values.length ? values.shift() : '')); };

// ---------------------------------------------------------------------------
// Files: the ones picked, and the ones next to the model (read from its folder when Blockbench may)
// ---------------------------------------------------------------------------

const extOf = name => (String(name).match(/\.([^.\/\\]+)$/) || [, ''])[1].toLowerCase();
const baseOf = name => String(name).replace(/\\/g, '/').split('/').pop();
const textOf = buffer => new TextDecoder('utf-8').decode(buffer);
const MIME = {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tga: 'application/octet-stream'};

let fs_module, path_module;
function nodeFs() {
	if (fs_module !== undefined) return fs_module;
	fs_module = null;
	try {
		if (typeof requireNativeModule == 'function') { fs_module = requireNativeModule('fs', {message: 'Read the textures and other files next to the imported model'}); path_module = requireNativeModule('path'); }
		else if (typeof require == 'function') { fs_module = require('fs'); path_module = require('path'); }
	} catch (err) { fs_module = null; }
	return fs_module;
}

class Resources {
	constructor(files, main) {
		this.files = new Map();     // lower case name -> {name, buffer}
		this.urls = new Map();
		this.names = new Map();    // blob url -> the file's name (the name of a texture)
		this.dir = null;
		for (const f of files) this.files.set(baseOf(f.name).toLowerCase(), f);
		if (main && main.path && /[\\/]/.test(main.path)) this.dir = main.path.replace(/[\\/][^\\/]*$/, '');
	}
	// a file by name: picked, or found in the folder of the model (also in a "textures" folder next to it, any letter case)
	get(name) {
		const key = baseOf(name).toLowerCase();
		if (this.files.has(key)) return this.files.get(key);
		const fs = this.dir && nodeFs();
		if (!fs) return null;
		for (const sub of ['', 'textures', 'Textures', 'texture', 'tex', 'maps', 'images', '..', '../textures', '../Textures']) {
			try {
				const dir = sub ? path_module.join(this.dir, sub) : this.dir;
				const hit = fs.readdirSync(dir).find(n => n.toLowerCase() == key);
				if (hit) {
					const data = fs.readFileSync(path_module.join(dir, hit));
					const f = {name: hit, buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)};
					this.files.set(key, f);
					return f;
				}
			} catch (err) { /* no such folder */ }
		}
		return null;
	}
	// a file with the same name and another picture format (a model that asks for .tga when there is a .png)
	getAnyImage(name) {
		const stem = baseOf(name).replace(/\.[^.]*$/, '');
		for (const ext of ['', 'png', 'jpg', 'jpeg', 'tga', 'bmp', 'webp']) {
			const f = ext ? this.get(stem + '.' + ext) : this.get(name);
			if (f) return f;
		}
		return null;
	}
	url(name) {
		const key = baseOf(name).toLowerCase();
		if (this.urls.has(key)) return this.urls.get(key);
		const f = /\.(png|jpe?g|tga|bmp|gif|webp|dds)$/i.test(key) ? this.getAnyImage(name) : this.get(name);
		const url = f ? URL.createObjectURL(new Blob([f.buffer], {type: MIME[extOf(f.name)] || 'application/octet-stream'})) : null;
		this.urls.set(key, url);
		if (url) this.names.set(url, f.name);
		return url;
	}
	// what a loader asks for -> a blob of the right file
	resolve(url) {
		if (/^(data|blob):/.test(url)) return url;
		let clean = url;
		try { clean = decodeURIComponent(url); } catch (err) { /* keep it */ }
		clean = clean.split(/[?#]/)[0];
		return this.url(clean) || url;
	}
	dispose() { this.urls.forEach(u => { if (u) URL.revokeObjectURL(u); }); }
}

// a loading manager that knows the files and can be waited for (textures load after the model is read)
function managerFor(res) {
	const m = new THREE.LoadingManager();
	let pending = 0, waiting = [];
	const start = m.itemStart.bind(m), end = m.itemEnd.bind(m);
	m.itemStart = url => { pending++; start(url); };
	m.itemEnd = url => { pending = Math.max(0, pending - 1); end(url); if (!pending) { waiting.forEach(r => r()); waiting = []; } };
	m.setURLModifier(url => res.resolve(url));
	m.addHandler(/\.tga$/i, new L.TGALoader(m));
	m.idle = (timeout = 20000) => pending ? Promise.race([new Promise(r => waiting.push(r)), new Promise(r => setTimeout(r, timeout))]) : Promise.resolve();
	return m;
}

// ---------------------------------------------------------------------------
// Half-Life (GoldSrc) MDL, version 10: bones, meshes (triangle strips and fans), 8 bit textures, sequences
// ---------------------------------------------------------------------------

function reader(buffer) {
	const dv = new DataView(buffer), u8 = new Uint8Array(buffer);
	return {
		dv, u8, size: buffer.byteLength,
		i32: o => dv.getInt32(o, true), u16: o => dv.getUint16(o, true), i16: o => dv.getInt16(o, true), f32: o => dv.getFloat32(o, true),
		str: (o, n) => { let s = ''; for (let i = 0; i < n && u8[o + i]; i++) s += String.fromCharCode(u8[o + i]); return s; },
		vec: o => [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)],
	};
}

// Half-Life's angles (roll, pitch, yaw around x, y, z) as a quaternion: AngleQuaternion of the SDK
function hlQuat(a) {
	const sy = Math.sin(a[2] / 2), cy = Math.cos(a[2] / 2), sp = Math.sin(a[1] / 2), cp = Math.cos(a[1] / 2), sr = Math.sin(a[0] / 2), cr = Math.cos(a[0] / 2);
	return new THREE.Quaternion(sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy, cr * cp * cy + sr * sp * sy);
}
// Half-Life is Z up and looks along +X; Blockbench is Y up and looks along -Z
const HL_TO_Y_UP = new THREE.Matrix4().set(0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1);

function goldsrcTextures(r, base_name, notes) {
	const textures = [];
	const num = r.i32(180), index = r.i32(184);
	for (let t = 0; t < num; t++) {
		const o = index + t * 80, name = r.str(o, 64), flags = r.i32(o + 64), w = r.i32(o + 68), h = r.i32(o + 72), data = r.i32(o + 76);
		if (w <= 0 || h <= 0 || data + w * h + 768 > r.size) { textures.push(null); continue; }
		const canvas = document.createElement('canvas');
		canvas.width = w; canvas.height = h;
		const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h), pal = data + w * h;
		const masked = !!(flags & 0x40);
		for (let i = 0; i < w * h; i++) {
			const c = r.u8[data + i];
			img.data[i * 4] = r.u8[pal + c * 3]; img.data[i * 4 + 1] = r.u8[pal + c * 3 + 1]; img.data[i * 4 + 2] = r.u8[pal + c * 3 + 2];
			img.data[i * 4 + 3] = masked && c == 255 ? 0 : 255;
		}
		ctx.putImageData(img, 0, 0);
		const tex = new THREE.CanvasTexture(canvas);
		tex.flipY = false;   // the coordinates below are counted from the top
		tex.name = name.replace(/\.bmp$/i, '');
		textures.push({tex, w, h, masked, name: tex.name});
	}
	return textures;
}

function parseGoldSrc(buffer, res, file_name, notes) {
	const r = reader(buffer);
	const base = file_name.replace(/\.mdl$/i, '');
	// bones, in the reference pose
	const num_bones = r.i32(140), bone_index = r.i32(144);
	const bones = [], info = [];
	const wrapper = new THREE.Group();
	wrapper.name = 'hl_axes';
	wrapper.quaternion.setFromRotationMatrix(HL_TO_Y_UP);
	for (let b = 0; b < num_bones; b++) {
		const o = bone_index + b * 112;
		const value = [], scale = [];
		for (let k = 0; k < 6; k++) { value.push(r.f32(o + 64 + k * 4)); scale.push(r.f32(o + 88 + k * 4)); }
		const bone = new THREE.Bone();
		bone.name = r.str(o, 32) || 'bone' + b;
		bone.position.set(value[0], value[1], value[2]);
		bone.quaternion.copy(hlQuat([value[3], value[4], value[5]]));
		bones.push(bone);
		info.push({parent: r.i32(o + 32), value, scale});
	}
	bones.forEach((bone, b) => { const p = info[b].parent; (p >= 0 && bones[p] ? bones[p] : wrapper).add(bone); });
	const root = new THREE.Group();
	root.name = base;
	root.add(wrapper);
	root.updateMatrixWorld(true);

	// textures: in this file, or in <name>T.mdl
	let tex_reader = r;
	if (!r.i32(180)) {
		const tf = res.get(base + 't.mdl');
		if (tf) tex_reader = reader(tf.buffer); else notes.push(fill(tr('mdl_textures'), base));
	}
	const textures = goldsrcTextures(tex_reader, base, notes);
	const materials = textures.map((t, i) => {
		const m = new THREE.MeshLambertMaterial({map: t ? t.tex : null, color: t ? 0xffffff : 0xbbbbbb, name: t ? t.name : 'texture' + i});
		if (t && t.masked) { m.transparent = true; m.alphaTest = 0.5; }
		return m;
	});
	const fallback = new THREE.MeshLambertMaterial({color: 0xbbbbbb, name: 'untextured'});
	// skin family 0: the texture of every mesh
	const num_skinref = tex_reader.i32(192), skin_index = tex_reader.i32(200);
	const skinref = i => num_skinref && skin_index && i < num_skinref ? tex_reader.i16(skin_index + i * 2) : i;

	// the meshes of the first model of every body part
	const positions = [], uvs = [], skin_i = [], skin_w = [], groups = [];
	const used_materials = [];
	const num_bodyparts = r.i32(204), bodypart_index = r.i32(208);
	const v = new THREE.Vector3(), n = new THREE.Vector3();
	for (let bp = 0; bp < num_bodyparts; bp++) {
		const bo = bodypart_index + bp * 76, nummodels = r.i32(bo + 64), modelindex = r.i32(bo + 72);
		if (nummodels < 1) continue;
		const mo = modelindex;
		const numverts = r.i32(mo + 80), vertinfo = r.i32(mo + 84), vertindex = r.i32(mo + 88), norminfo = r.i32(mo + 96), normindex = r.i32(mo + 100);
		const nummesh = r.i32(mo + 72), meshindex = r.i32(mo + 76);
		const vbone = k => r.u8[vertinfo + k], nbone = k => r.u8[norminfo + k];
		const vpos = k => { const b = bones[vbone(k)] || bones[0]; v.set(...r.vec(vertindex + k * 12)); return b ? v.applyMatrix4(b.matrixWorld).clone() : v.clone(); };
		const vnorm = k => { const b = bones[nbone(k)] || bones[0]; n.set(...r.vec(normindex + k * 12)); return b ? n.transformDirection(b.matrixWorld).clone() : n.clone(); };
		for (let me = 0; me < nummesh; me++) {
			const mo2 = meshindex + me * 20, triindex = r.i32(mo2 + 4), sref = r.i32(mo2 + 8);
			const ti = skinref(sref), t = textures[ti];
			const material = t ? materials[ti] : fallback;
			let mat_i = used_materials.indexOf(material);
			if (mat_i < 0) { used_materials.push(material); mat_i = used_materials.length - 1; }
			const start = positions.length / 3;
			const W = t ? t.w : 1, H = t ? t.h : 1;
			const emit = (a, b, c) => {
				const pa = vpos(a.v), pb = vpos(b.v), pc = vpos(c.v);
				// the right way round: as the normals of the vertices say
				const face = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
				const avg = vnorm(a.n).add(vnorm(b.n)).add(vnorm(c.n));
				const list = face.dot(avg) < 0 ? [a, c, b] : [a, b, c];
				for (const x of list) {
					const p = vpos(x.v);
					positions.push(p.x, p.y, p.z);
					uvs.push(x.s / W, x.t / H);
					skin_i.push(vbone(x.v), 0, 0, 0);
					skin_w.push(1, 0, 0, 0);
				}
			};
			let p = triindex;
			for (let guard = 0; guard < 100000; guard++) {
				if (p + 2 > r.size) break;
				let count = r.i16(p); p += 2;
				if (!count) break;
				const fan = count < 0;
				count = Math.abs(count);
				const list = [];
				for (let k = 0; k < count; k++) { list.push({v: r.i16(p), n: r.i16(p + 2), s: r.i16(p + 4), t: r.i16(p + 6)}); p += 8; }
				for (let k = 2; k < count; k++) {
					if (list[k].v >= numverts || list[k - 1].v >= numverts || list[k - 2].v >= numverts) continue;
					if (fan) emit(list[0], list[k - 1], list[k]);
					else if (k % 2 == 0) emit(list[k - 2], list[k - 1], list[k]);
					else emit(list[k - 1], list[k - 2], list[k]);
				}
			}
			const count = positions.length / 3 - start;
			if (count) groups.push({start, count, materialIndex: mat_i});
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skin_i, 4));
	geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skin_w, 4));
	groups.forEach(g => geometry.addGroup(g.start, g.count, g.materialIndex));
	const mesh = new THREE.SkinnedMesh(geometry, used_materials.length ? used_materials : [fallback]);
	mesh.name = base;
	root.add(mesh);
	root.updateMatrixWorld(true);
	mesh.bind(new THREE.Skeleton(bones), new THREE.Matrix4());

	// sequences: the animation of every bone, frame by frame (the values are run-length packed)
	const clips = [];
	const num_seq = r.i32(164), seq_index = r.i32(168);
	let missing_group = false;
	for (let s = 0; s < num_seq; s++) {
		const o = seq_index + s * 176;
		const label = r.str(o, 32), fps = r.f32(o + 32) || 30, frames = Math.max(1, r.i32(o + 56)), anim_index = r.i32(o + 124), group = r.i32(o + 156);
		let ar = r;
		if (group > 0) {
			const gf = res.get(base + String(group).padStart(2, '0') + '.mdl');
			if (!gf) { missing_group = true; continue; }
			ar = reader(gf.buffer);
		}
		const times = [];
		for (let f = 0; f < frames; f++) times.push(f / fps);
		const tracks = [];
		for (let b = 0; b < num_bones; b++) {
			const anim = anim_index + b * 12;
			if (anim + 12 > ar.size) break;
			const value = (j, frame) => {
				const off = ar.u16(anim + j * 2);
				if (!off) return 0;
				let p = anim + off, k = frame;
				for (let guard = 0; guard < 10000; guard++) {
					const valid = ar.u8[p], total = ar.u8[p + 1];
					if (!total) return 0;
					if (total > k) return valid > k ? ar.i16(p + (k + 1) * 2) : ar.i16(p + valid * 2);
					k -= total;
					p += (valid + 1) * 2;
					if (p + 2 > ar.size) return 0;
				}
				return 0;
			};
			const pos = [], quat = [];
			const I = info[b];
			for (let f = 0; f < frames; f++) {
				const ch = [0, 1, 2, 3, 4, 5].map(j => I.value[j] + value(j, f) * I.scale[j]);
				pos.push(ch[0], ch[1], ch[2]);
				const q = hlQuat([ch[3], ch[4], ch[5]]);
				quat.push(q.x, q.y, q.z, q.w);
			}
			tracks.push(new THREE.VectorKeyframeTrack(bones[b].uuid + '.position', times, pos));
			tracks.push(new THREE.QuaternionKeyframeTrack(bones[b].uuid + '.quaternion', times, quat));
		}
		clips.push(new THREE.AnimationClip(label || 'sequence' + s, Math.max(1 / fps, (frames - 1) / fps), tracks));
	}
	if (missing_group) notes.push(fill(tr('mdl_seqgroup'), base));
	return {root, clips, units: 'inch'};
}

// ---------------------------------------------------------------------------
// Quake MDL (IDPO, version 6): the first frame and the first skin
// ---------------------------------------------------------------------------

function parseQuake(buffer, res, file_name, notes) {
	const r = reader(buffer);
	const scale = r.vec(8), translate = r.vec(20);
	const num_skins = r.i32(48), sw = r.i32(52), sh = r.i32(56), num_verts = r.i32(60), num_tris = r.i32(64), num_frames = r.i32(68);
	let p = 84;
	// the palette: palette.lmp next to the model, or grey
	const lmp = res.get('palette.lmp');
	const pal = lmp && lmp.buffer.byteLength >= 768 ? new Uint8Array(lmp.buffer) : null;
	if (!pal) notes.push(tr('quake_palette'));
	let skin = null;
	for (let s = 0; s < num_skins; s++) {
		const group = r.i32(p); p += 4;
		let data = p, n = 1;
		if (group) { n = r.i32(p); p += 4 + n * 4; data = p; }
		if (!skin) skin = data;
		p += n * sw * sh;
	}
	const canvas = document.createElement('canvas');
	canvas.width = sw; canvas.height = sh;
	const ctx = canvas.getContext('2d'), img = ctx.createImageData(sw, sh);
	for (let i = 0; i < sw * sh; i++) {
		const c = skin !== null ? r.u8[skin + i] : 0;
		img.data[i * 4] = pal ? pal[c * 3] : c; img.data[i * 4 + 1] = pal ? pal[c * 3 + 1] : c; img.data[i * 4 + 2] = pal ? pal[c * 3 + 2] : c; img.data[i * 4 + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	const tex = new THREE.CanvasTexture(canvas);
	tex.flipY = false;
	tex.name = file_name.replace(/\.mdl$/i, '') + '_skin';
	const st = [];
	for (let i = 0; i < num_verts; i++) { st.push({seam: r.i32(p), s: r.i32(p + 4), t: r.i32(p + 8)}); p += 12; }
	const tris = [];
	for (let i = 0; i < num_tris; i++) { tris.push({front: r.i32(p), v: [r.i32(p + 4), r.i32(p + 8), r.i32(p + 12)]}); p += 16; }
	// the first frame
	const type = r.i32(p); p += 4;
	if (type) { const n = r.i32(p); p += 4 + 8 + n * 4; }
	p += 8 + 16;   // its box and its name
	const verts = [];
	for (let i = 0; i < num_verts; i++) { verts.push([0, 1, 2].map(k => r.u8[p + i * 4 + k] * scale[k] + translate[k])); }
	if (num_frames > 1) notes.push(tr('morph'));
	const positions = [], uvs = [];
	for (const t of tris) {
		for (const k of [0, 2, 1]) {   // Quake turns its triangles the other way
			const i = t.v[k], v = verts[i] || [0, 0, 0];
			positions.push(v[0], v[1], v[2]);
			let s = st[i] ? st[i].s : 0;
			if (st[i] && !t.front && st[i].seam) s += sw / 2;
			uvs.push((s + 0.5) / sw, ((st[i] ? st[i].t : 0) + 0.5) / sh);
		}
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
	geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
	const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({map: tex, name: tex.name}));
	mesh.name = file_name.replace(/\.mdl$/i, '');
	const root = new THREE.Group();
	const axes = new THREE.Group();
	axes.quaternion.setFromRotationMatrix(HL_TO_Y_UP);   // Quake has the same axes as Half-Life
	axes.add(mesh);
	root.add(axes);
	return {root, clips: [], units: 'inch'};
}

// ---------------------------------------------------------------------------
// Reading a model into a three.js scene
// ---------------------------------------------------------------------------

async function loadModel(main, res, notes) {
	const ext = extOf(main.name);
	const manager = managerFor(res);
	let root = null, clips = [];
	const done = obj => { root = obj; clips = (obj && obj.animations) || []; };
	if (ext == 'fbx') done(new L.FBXLoader(manager).parse(main.buffer, ''));
	else if (ext == 'gltf' || ext == 'glb') {
		const gltf = await new Promise((ok, fail) => new L.GLTFLoader(manager).parse(ext == 'glb' ? main.buffer : textOf(main.buffer), '', ok, fail));
		root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
		clips = gltf.animations || [];
	} else if (ext == 'dae') {
		const c = new L.ColladaLoader(manager).parse(textOf(main.buffer), '');
		root = c.scene;
		clips = (c.scene && c.scene.animations && c.scene.animations.length ? c.scene.animations : c.animations) || [];
	} else if (ext == 'obj') {
		const text = textOf(main.buffer), loader = new L.OBJLoader(manager);
		const libs = [...text.matchAll(/^[ \t]*mtllib[ \t]+(.+?)[ \t]*$/gm)].map(m => m[1]);
		let creator = null;
		for (const lib of libs) {
			const f = res.get(lib);
			if (!f) continue;
			const c = new L.MTLLoader(manager).parse(textOf(f.buffer), '');
			if (creator) Object.assign(creator.materialsInfo, c.materialsInfo); else creator = c;
		}
		if (creator) { creator.preload(); loader.setMaterials(creator); }
		done(loader.parse(text));
	} else if (ext == '3ds') done(new L.TDSLoader(manager).parse(main.buffer, ''));
	else if (ext == 'stl' || ext == 'ply') {
		const geometry = (ext == 'stl' ? new L.STLLoader(manager) : new L.PLYLoader(manager)).parse(main.buffer);
		const material = new THREE.MeshLambertMaterial({color: 0xc8c8c8, vertexColors: !!geometry.attributes.color, name: 'material'});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = main.name.replace(/\.[^.]*$/, '');
		root = new THREE.Group();
		root.add(mesh);
	} else if (ext == '3mf') done(new L.ThreeMFLoader(manager).parse(main.buffer));
	else if (ext == 'md2') {
		const geometry = new L.MD2Loader(manager).parse(main.buffer);
		if (geometry.morphAttributes && geometry.morphAttributes.position && geometry.morphAttributes.position.length > 1) notes.push(tr('morph'));
		const skin = res.getAnyImage(main.name.replace(/\.md2$/i, '.png'));
		let material = new THREE.MeshLambertMaterial({color: 0xc8c8c8, name: 'skin'});
		if (skin) { material = new THREE.MeshLambertMaterial({map: new THREE.TextureLoader(manager).load(res.url(skin.name)), name: 'skin'}); }
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = main.name.replace(/\.md2$/i, '');
		root = new THREE.Group();
		root.add(mesh);
	} else if (ext == 'mdl') {
		const r = reader(main.buffer), id = r.str(0, 4), version = r.i32(4);
		let out;
		if (id == 'IDST' && version == 10) out = parseGoldSrc(main.buffer, res, main.name, notes);
		else if (id == 'IDPO') out = parseQuake(main.buffer, res, main.name, notes);
		else if (id == 'IDST') throw new Error(fill(tr('source_mdl'), version));
		else throw new Error(tr('unknown'));
		root = out.root; clips = out.clips;
	} else throw new Error(tr('unknown'));
	await manager.idle();
	return {root, clips};
}

// ---------------------------------------------------------------------------
// The scene -> Blockbench: textures, meshes, bone groups or an armature, animations
// ---------------------------------------------------------------------------

// how this Blockbench turns the rotation of a group into three.js angles (some versions mirror x and y)
let signs_cache = null;
function rotationSigns() {
	if (signs_cache) return signs_cache;
	try {
		const g = Group.all.find(x => x.mesh);
		if (g && Canvas.updateAllBones) {
			const saved = g.rotation.slice();
			g.rotation = [10, 20, 30];
			Canvas.updateAllBones([g]);
			const e = g.mesh.rotation, found = [Math.sign(e.x), Math.sign(e.y), Math.sign(e.z)];
			g.rotation = saved;
			Canvas.updateAllBones([g]);
			if (found.every(v => v !== 0)) signs_cache = found;
		}
	} catch (err) { /* keep the guess */ }
	return signs_cache || [1, 1, 1];
}

const canArmature = () => typeof Armature == 'function' && typeof ArmatureBone == 'function' && typeof Format != 'undefined' && Format && !!Format.armature_rig;

// the pictures of the model as Blockbench textures
class TextureBank {
	constructor(o, res) {
		this.o = o;
		this.res = res;
		this.by_image = new Map();
		this.colors = new Map();     // '#rrggbb' -> cell
		this.created = [];
		this.palette = null;
	}
	uvSize(tex) {
		if (typeof Format != 'undefined' && Format.per_texture_uv_size && tex.uv_width) return [tex.uv_width, tex.uv_height];
		return [Project.texture_width || 16, Project.texture_height || 16];
	}
	// a three.js texture -> {texture, size, flip, matrix} (null when it has no readable picture)
	forMap(map, fallback_name) {
		const image = map && map.image;
		if (!image) return null;
		// the same picture file used by several materials is one texture
		const file = image.src && this.res && this.res.names.get(image.src);
		const key = file ? 'file:' + file.toLowerCase() : image;
		if (this.by_image.has(key)) return this.by_image.get(key);
		let canvas = null;
		try {
			const w = image.width || (image.data && image.width), h = image.height;
			if (!w || !h) return null;
			canvas = document.createElement('canvas');
			canvas.width = w; canvas.height = h;
			const ctx = canvas.getContext('2d');
			if (image.data && !(image instanceof HTMLImageElement) && !(typeof ImageBitmap != 'undefined' && image instanceof ImageBitmap) && !(image instanceof HTMLCanvasElement)) {
				// raw pixels (TGA, data textures): RGBA or RGB
				const img = ctx.createImageData(w, h), src = image.data, ch = src.length / (w * h);
				for (let i = 0; i < w * h; i++) {
					img.data[i * 4] = src[i * ch]; img.data[i * 4 + 1] = src[i * ch + 1]; img.data[i * 4 + 2] = src[i * ch + 2];
					img.data[i * 4 + 3] = ch >= 4 ? src[i * ch + 3] : 255;
				}
				ctx.putImageData(img, 0, 0);
			} else ctx.drawImage(image, 0, 0, w, h);
		} catch (err) { console.warn('[Import] texture', err); return null; }
		let name = map.name || '';
		if (!name && image.src && this.res && this.res.names.has(image.src)) name = this.res.names.get(image.src);
		if (!name && image.src && !/^(blob|data):/.test(image.src)) { try { name = decodeURIComponent(baseOf(image.src)); } catch (err) { name = baseOf(image.src); } }
		name = (name || fallback_name || 'texture').replace(/\.[^.]*$/, '');
		const texture = new Texture({name}).fromDataURL(canvas.toDataURL('image/png')).add(false);
		if ('uv_width' in texture) { texture.uv_width = canvas.width; texture.uv_height = canvas.height; }
		this.created.push(texture);
		map.updateMatrix && map.updateMatrix();
		const plain = map.offset.x == 0 && map.offset.y == 0 && map.repeat.x == 1 && map.repeat.y == 1 && !map.rotation;
		const entry = {texture, flip: map.flipY !== false, matrix: plain ? null : map.matrix.clone(), size: null};
		this.by_image.set(key, entry);
		return entry;
	}
	// a plain colour: a cell of the colour palette (made at the end)
	colorCell(hex) {
		if (!this.colors.has(hex)) this.colors.set(hex, this.colors.size);
		return this.colors.get(hex);
	}
	makePalette() {
		if (!this.colors.size) return;
		const n = Math.ceil(Math.sqrt(this.colors.size)), cell = 4, size = n * cell;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext('2d');
		for (const [hex, i] of this.colors) { ctx.fillStyle = hex; ctx.fillRect((i % n) * cell, Math.floor(i / n) * cell, cell, cell); }
		const texture = new Texture({name: 'colors'}).fromDataURL(canvas.toDataURL('image/png')).add(false);
		if ('uv_width' in texture) { texture.uv_width = size; texture.uv_height = size; }
		this.created.push(texture);
		this.palette = {texture, n, cell, size};
	}
	// the uv (in the texture's pixels) of a colour cell
	cellUV(i) {
		const p = this.palette, [W, H] = this.uvSize(p.texture);
		return [((i % p.n) + 0.5) * p.cell / p.size * W, (Math.floor(i / p.n) + 0.5) * p.cell / p.size * H];
	}
}

const hexOf = c => '#' + c.getHexString();
// one component of a buffer attribute (r129 has no getComponent)
const comp = (attr, i, k) => k == 0 ? attr.getX(i) : k == 1 ? attr.getY(i) : k == 2 ? attr.getZ(i) : attr.getW(i);

// every triangle of the scene, in Blockbench's space: {p: [3 x Vector3], uv: [3 x [u,v]] (0..1) | null, mat, color, mesh, bones: [3 x [[node, w]...]], owner}
function collectTriangles(root, meshes, M, owner_of, bone_nodes_of, bank, o) {
	const tris = [];
	const v = new THREE.Vector3(), uvm = new THREE.Vector3();
	for (const mesh of meshes) {
		const g = mesh.geometry, pos = g.attributes.position;
		if (!pos) continue;
		const uv = g.attributes.uv, col = g.attributes.color, index = g.index;
		const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
		const skinned = mesh.isSkinnedMesh && mesh.skeleton && si && sw;
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		const flip = mesh.matrixWorld.determinant() < 0;
		const world = new Array(pos.count);
		for (let i = 0; i < pos.count; i++) {
			if (skinned) mesh.boneTransform(i, v); else v.fromBufferAttribute(pos, i);
			world[i] = v.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(M);
		}
		const vertexBones = i => {
			if (!skinned) return null;
			const list = [];
			for (let k = 0; k < 4; k++) {
				const w = comp(sw, i, k);
				if (w > 0.005) { const node = bone_nodes_of(mesh.skeleton.bones[comp(si, i, k)]); if (node) list.push([node, w]); }
			}
			return list;
		};
		const ranges = g.groups && g.groups.length ? g.groups : [{start: 0, count: index ? index.count : pos.count, materialIndex: 0}];
		for (const range of ranges) {
			const material = mats[range.materialIndex || 0] || mats[0];
			const map = o.textures && material && material.map ? bank.forMap(material.map, material.name) : null;
			const base_color = material && material.color ? material.color : new THREE.Color(0xc8c8c8);
			const end = Math.min(range.start + range.count, index ? index.count : pos.count);
			for (let k = range.start; k + 2 < end; k += 3) {
				let ids = index ? [index.getX(k), index.getX(k + 1), index.getX(k + 2)] : [k, k + 1, k + 2];
				if (flip) ids = [ids[0], ids[2], ids[1]];
				const p = ids.map(i => world[i]);
				if (new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0])).lengthSq() < 1e-12) continue;
				let uvs = null, color = null;
				if (map && uv) {
					uvs = ids.map(i => {
						let u = uv.getX(i), w = uv.getY(i);
						if (map.matrix) { uvm.set(u, w, 1).applyMatrix3(map.matrix); u = uvm.x; w = uvm.y; }
						return [u, map.flip ? 1 - w : w];
					});
				} else if (o.textures) {
					let c = base_color;
					if (col && material && material.vertexColors) {
						c = new THREE.Color(0, 0, 0);
						ids.forEach(i => { c.r += col.getX(i) / 3; c.g += col.getY(i) / 3; c.b += col.getZ(i) / 3; });
						c.multiply(base_color);
					}
					// a few hundred colours at most: near ones share a cell
					const q = x => Math.round(x * 31) / 31;
					color = bank.colorCell(hexOf(new THREE.Color(q(c.r), q(c.g), q(c.b))));
				}
				tris.push({p, uv: uvs, map, color, mesh, material, bones: skinned ? ids.map(vertexBones) : null, owner: owner_of(mesh)});
			}
		}
	}
	return tris;
}

// two triangles that share an edge, lie in one plane, have the same texture and the same uv on the edge -> one quad
function mergeQuads(tris) {
	const key = p => p.x.toFixed(4) + ',' + p.y.toFixed(4) + ',' + p.z.toFixed(4);
	const normal = t => new THREE.Vector3().subVectors(t.p[1], t.p[0]).cross(new THREE.Vector3().subVectors(t.p[2], t.p[0])).normalize();
	const edges = new Map();
	tris.forEach((t, ti) => { t.keys = t.p.map(key); t.n = normal(t); for (let e = 0; e < 3; e++) { const a = t.keys[e], b = t.keys[(e + 1) % 3]; edges.set(a + '|' + b, {ti, e}); } });
	const used = new Set(), out = [];
	const sameUV = (a, b) => !a && !b || (a && b && Math.abs(a[0] - b[0]) < 1e-5 && Math.abs(a[1] - b[1]) < 1e-5);
	tris.forEach((t, ti) => {
		if (used.has(ti)) return;
		let best = null;
		for (let e = 0; e < 3 && !best; e++) {
			const a = t.keys[e], b = t.keys[(e + 1) % 3];
			const hit = edges.get(b + '|' + a);
			if (!hit || hit.ti == ti || used.has(hit.ti)) continue;
			const s = tris[hit.ti];
			if (s.map !== t.map || s.color !== t.color || s.material !== t.material || s.owner !== t.owner || t.n.dot(s.n) < 0.9995) continue;
			// the shared edge must carry the same uv in both, and the same bone weights
			const ia = e, ib = (e + 1) % 3, ja = (hit.e + 1) % 3, jb = hit.e;
			if (t.uv && !(sameUV(t.uv[ia], s.uv[ja]) && sameUV(t.uv[ib], s.uv[jb]))) continue;
			const q = 3 - hit.e - ((hit.e + 1) % 3);   // the third corner of the other triangle
			// p0 = start of the edge, p1 = end, p2 = the third corner of t
			const i2 = (e + 2) % 3;
			const loop = [ia, 'q', ib, i2];
			const P = i => i === 'q' ? s.p[q] : t.p[i];
			// convex: every corner turns the same way
			let convex = true;
			for (let k = 0; k < 4 && convex; k++) {
				const A = P(loop[k]), B = P(loop[(k + 1) % 4]), C = P(loop[(k + 2) % 4]);
				if (new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, B)).dot(t.n) <= 1e-9) convex = false;
			}
			if (convex) best = {hit, loop, q};
		}
		if (!best) { out.push(t); used.add(ti); return; }
		const s = tris[best.hit.ti];
		used.add(ti); used.add(best.hit.ti);
		const pick = (arr, sarr) => best.loop.map(i => i === 'q' ? sarr[best.q] : arr[i]);
		out.push(Object.assign({}, t, {p: pick(t.p, s.p), uv: t.uv ? pick(t.uv, s.uv) : null, bones: t.bones ? pick(t.bones, s.bones) : null}));
	});
	return out;
}

// builds one Blockbench mesh from faces; returns {el, keys (per face, per corner)}
function buildMesh(name, origin, faces, bank, weights_out) {
	const el = new Mesh({name, origin: origin.map(v => Math.round(v * 1000) / 1000), vertices: {}});
	const index = new Map(), points = [], point_bones = [];
	const key = p => p.x.toFixed(3) + ',' + p.y.toFixed(3) + ',' + p.z.toFixed(3);
	const corner = faces.map(f => f.p.map((p, k) => {
		const id = key(p);
		if (!index.has(id)) { index.set(id, points.length); points.push([p.x - origin[0], p.y - origin[1], p.z - origin[2]].map(v => Math.round(v * 10000) / 10000)); point_bones.push(f.bones ? f.bones[k] : null); }
		return index.get(id);
	}));
	const vkeys = el.addVertices(...points);
	const mesh_faces = faces.map((f, fi) => {
		const vertices = corner[fi].map(i => vkeys[i]);
		if (new Set(vertices).size < vertices.length) return null;
		const uv = {};
		let texture = false;
		if (f.uv && f.map) {
			const [W, H] = bank.uvSize(f.map.texture);
			// a face that runs past the edge of a repeating texture is moved back onto it
			const su = Math.floor(f.uv.reduce((s, x) => s + x[0], 0) / f.uv.length), sv = Math.floor(f.uv.reduce((s, x) => s + x[1], 0) / f.uv.length);
			vertices.forEach((vk, k) => { uv[vk] = [(f.uv[k][0] - su) * W, (f.uv[k][1] - sv) * H]; });
			texture = f.map.texture.uuid;
		} else if (f.color !== null && f.color !== undefined && bank.palette) {
			const c = bank.cellUV(f.color);
			vertices.forEach(vk => { uv[vk] = c.slice(); });
			texture = bank.palette.texture.uuid;
		}
		return new MeshFace(el, {vertices, uv, texture});
	}).filter(Boolean);
	el.addFaces(...mesh_faces);
	if (weights_out) points.forEach((p, i) => { if (point_bones[i]) weights_out.push([vkeys[i], point_bones[i]]); });
	return el;
}

// key reduction: a key is kept only where a straight line from the last kept one would miss by more than `tol`
function reduceKeys(samples, tol) {
	const n = samples.length;
	if (n <= 2) return samples.map((s, i) => i);
	const keep = [0];
	let last = 0;
	for (let i = 2; i < n; i++) {
		let bad = false;
		for (let j = last + 1; j < i && !bad; j++) {
			const t = (j - last) / (i - last);
			for (let a = 0; a < samples[j].length; a++) if (Math.abs(samples[last][a] + (samples[i][a] - samples[last][a]) * t - samples[j][a]) > tol) { bad = true; break; }
		}
		if (bad) { keep.push(i - 1); last = i - 1; }
	}
	keep.push(n - 1);
	return keep;
}

function convertScene(root, clips, o, model_name, notes, res) {
	root.updateMatrixWorld(true);
	const meshes = [];
	root.traverse(n => { if ((n.isMesh || n.isSkinnedMesh) && n.geometry && n.geometry.attributes.position && n.visible !== false) meshes.push(n); });
	if (!meshes.length) throw new Error(tr('no_mesh'));
	if (meshes.some(m => m.geometry.morphAttributes && Object.keys(m.geometry.morphAttributes).length) && !notes.includes(tr('morph'))) {
		if (clips.some(c => c.tracks.some(t => /morphTargetInfluences/.test(t.name)))) notes.push(tr('morph'));
	}
	// the rest pose of everything (the animations are sampled from it and it is put back after)
	const rest = new Map();
	root.traverse(n => rest.set(n, {p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone()}));
	const restore = () => { rest.forEach((r, n) => { n.position.copy(r.p); n.quaternion.copy(r.q); n.scale.copy(r.s); }); root.updateMatrixWorld(true); };

	// the nodes that move: bones of skeletons, and anything an animation moves
	const moving = new Set();
	const skinned = meshes.filter(m => m.isSkinnedMesh && m.skeleton);
	skinned.forEach(m => m.skeleton.bones.forEach(b => moving.add(b)));
	const animated_clips = o.animations ? clips.filter(c => c.duration > 0 && c.tracks.length) : [];
	for (const clip of animated_clips) for (const track of clip.tracks) {
		try {
			const pb = THREE.PropertyBinding.parseTrackName(track.name);
			if (!['position', 'quaternion', 'rotation', 'scale'].includes(pb.propertyName)) continue;
			const node = THREE.PropertyBinding.findNode(root, pb.nodeName);
			if (node && node !== root) moving.add(node);
		} catch (err) { /* a track of something else */ }
	}
	moving.delete(root);
	const ownerOf = node => { for (let n = node; n && n !== root; n = n.parent) if (moving.has(n)) return n; return null; };
	const boneNode = bone => moving.has(bone) ? bone : ownerOf(bone);

	// blended skin? (a vertex pulled by two bones or more)
	let blended = false;
	for (const m of skinned) {
		const sw = m.geometry.attributes.skinWeight;
		if (!sw) continue;
		for (let i = 0; i < sw.count && !blended; i++) { let n = 0; for (let k = 0; k < 4; k++) if (comp(sw, i, k) > 0.02) n++; if (n > 1) blended = true; }
	}
	const armature = blended && o.skin != 'groups' && canArmature() || (o.skin == 'armature' && canArmature() && moving.size > 0);

	// the size and the place in Blockbench
	const box = new THREE.Box3(), v = new THREE.Vector3();
	for (const m of meshes) {
		const pos = m.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 20000));
		for (let i = 0; i < pos.count; i += step) {
			if (m.isSkinnedMesh && m.skeleton) m.boneTransform(i, v); else v.fromBufferAttribute(pos, i);
			box.expandByPoint(v.applyMatrix4(m.matrixWorld));
		}
	}
	const size = box.getSize(new THREE.Vector3());
	const k = o.size == 'keep' ? Math.max(1e-6, o.factor) : Math.max(1e-6, o.height) / Math.max(1e-6, size.y || Math.max(size.x, size.z) || 1);
	const shift = o.ground ? new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2) : new THREE.Vector3();
	const M = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-shift.x, -shift.y, -shift.z));
	const M_inv = M.clone().invert();

	// pivots of the moving nodes (Blockbench pixels), and who is the parent of whom
	const nodes = [...moving];
	const pivot = new Map(nodes.map(n => [n, n.getWorldPosition(new THREE.Vector3()).applyMatrix4(M)]));
	const parentOf = n => ownerOf(n.parent);
	const depth = n => { let d = 0; for (let p = parentOf(n); p; p = parentOf(p)) d++; return d; };
	nodes.sort((a, b) => depth(a) - depth(b));
	const rest_world_inv = new Map(nodes.map(n => [n, n.matrixWorld.clone().invert()]));

	// the triangles
	const bank = new TextureBank(o, res);
	let tris = collectTriangles(root, meshes, M, m => ownerOf(m), boneNode, bank, o);
	if (tris.length > 60000) notes.push(fill(tr('too_big'), tris.length));
	bank.makePalette();
	// in bone groups a triangle goes with the bone that pulls its corners most
	if (!armature) tris.forEach(t => {
		if (!t.bones) return;
		const sum = new Map();
		t.bones.forEach(list => (list || []).forEach(([n, w]) => sum.set(n, (sum.get(n) || 0) + w)));
		let best = null, bw = -1;
		sum.forEach((w, n) => { if (w > bw) { bw = w; best = n; } });
		t.owner = best || t.owner;
		t.bones = null;
	});
	if (o.quads) tris = mergeQuads(tris);

	// --- Blockbench elements ---
	const groups = [], elements = [], bone_of = new Map();
	const name = model_name.replace(/\.[^.]*$/, '');
	const used_names = new Map();
	const unique = n => { const base = (n || 'part').replace(/[^\w\- .]/g, '_'); const c = used_names.get(base) || 0; used_names.set(base, c + 1); return c ? base + '_' + c : base; };
	const round = a => a.map(x => Math.round(x * 1000) / 1000);
	let top;
	if (armature) {
		top = new Armature({name}).addTo('root').init();
		for (const n of nodes) {
			const p = parentOf(n), here = pivot.get(n), at = p ? here.clone().sub(pivot.get(p)) : here.clone();
			const kids = nodes.filter(c => parentOf(c) === n);
			const length = kids.length ? Math.max(0.5, pivot.get(kids[0]).distanceTo(here)) : Math.max(0.5, size.y * k * 0.05);
			const bone = new ArmatureBone({name: unique(n.name || 'bone'), origin: round(at.toArray()), rotation: [0, 0, 0], length, width: Math.max(0.3, length * 0.15)});
			bone.addTo(p ? bone_of.get(p) : top).init();
			bone_of.set(n, bone);
			groups.push(bone);
		}
	} else {
		top = new Group({name, origin: [0, 0, 0]}).addTo('root').init();
		groups.push(top);
		for (const n of nodes) {
			const p = parentOf(n);
			const g = new Group({name: unique(n.name || 'bone'), origin: round(pivot.get(n).toArray()), rotation: [0, 0, 0]});
			g.addTo(p ? bone_of.get(p) : top).init();
			bone_of.set(n, g);
			groups.push(g);
		}
	}
	// meshes: one per source mesh (and per bone, in bone groups)
	const buckets = new Map();
	for (const t of tris) {
		const key = armature ? t.mesh.uuid : t.mesh.uuid + '|' + (t.owner ? t.owner.uuid : '');
		if (!buckets.has(key)) buckets.set(key, {mesh: t.mesh, owner: armature ? null : t.owner, faces: []});
		buckets.get(key).faces.push(t);
	}
	let bone_count = armature ? nodes.length : nodes.length;
	for (const b of buckets.values()) {
		let origin;
		if (b.owner && pivot.has(b.owner)) origin = pivot.get(b.owner).toArray();
		else { const bb = new THREE.Box3(); b.faces.forEach(f => f.p.forEach(p => bb.expandByPoint(p))); origin = bb.getCenter(new THREE.Vector3()).toArray(); }
		const label = (b.mesh.name || (b.faces[0].material && b.faces[0].material.name) || 'mesh') + (b.owner && !armature && b.owner.name && b.owner.name != b.mesh.name ? ' ' + b.owner.name : '');
		const weights = armature ? [] : null;
		const el = buildMesh(unique(label), armature ? [0, 0, 0] : origin, b.faces, bank, weights);
		el.addTo(armature ? top : (b.owner ? bone_of.get(b.owner) : top)).init();
		elements.push(el);
		if (armature) {
			const static_owner = ownerOf(b.mesh);
			for (const [vkey, list] of weights) {
				const total = list.reduce((s, x) => s + x[1], 0) || 1;
				list.forEach(([n, w]) => { const bone = bone_of.get(n); if (bone && w / total > 0.01) bone.setVertexWeight(el, vkey, Math.round(w / total * 1000) / 1000); });
			}
			// a rigid part inside the armature follows the bone it hangs from
			if (!weights.length && static_owner && bone_of.has(static_owner)) Object.keys(el.vertices).forEach(vk => bone_of.get(static_owner).setVertexWeight(el, vk, 1));
		}
	}

	// --- animations ---
	const animations = [];
	if (animated_clips.length && nodes.length) {
		const fps = Math.max(1, Math.min(120, Math.round(o.fps || 30)));
		const signs = armature ? [1, 1, 1] : rotationSigns();
		const order = (typeof Format != 'undefined' && Format.euler_order) || 'ZYX';
		const mixer = new THREE.AnimationMixer(root);
		const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
		for (const clip of animated_clips) {
			const frames = Math.max(1, Math.min(Math.ceil(Math.min(clip.duration, 600) * fps), 36000));
			const samples = new Map(nodes.map(n => [n, {pos: [], rot: [], scl: []}]));
			const action = mixer.clipAction(clip);
			action.play();
			for (let f = 0; f <= frames; f++) {
				mixer.setTime(Math.min(clip.duration, f / fps));
				root.updateMatrixWorld(true);
				const G = new Map();
				for (const n of nodes) {
					// how the node moved from its rest place, in Blockbench space, carried to its pivot
					const S = M.clone().multiply(n.matrixWorld).multiply(rest_world_inv.get(n)).multiply(M_inv);
					const here = pivot.get(n);
					const g = S.multiply(T(here.x, here.y, here.z));
					G.set(n, g);
					const p = parentOf(n), parent_g = p ? G.get(p) : null;
					const local = parent_g ? parent_g.clone().invert().multiply(g) : g.clone();
					const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
					local.decompose(pos, quat, scl);
					const rest_offset = p ? here.clone().sub(pivot.get(p)) : here.clone();
					const s = samples.get(n);
					s.pos.push(pos.sub(rest_offset).toArray());
					const e = new THREE.Euler().setFromQuaternion(quat, order);
					let deg = [e.x, e.y, e.z].map((r, i) => r * 180 / Math.PI * signs[i]);
					const prev = s.rot[s.rot.length - 1];
					if (prev) deg = deg.map((d, i) => d + 360 * Math.round((prev[i] - d) / 360));
					s.rot.push(deg);
					s.scl.push(scl.toArray());
				}
			}
			action.stop();
			mixer.uncacheAction(clip);
			restore();
			const animation = new Animation({name: clip.name || 'animation', length: Math.round(clip.duration * 1000) / 1000, loop: 'loop', snapping: fps}).add(false);
			const r4 = x => Math.round(x * 1e4) / 1e4;
			for (const n of nodes) {
				const target = bone_of.get(n), s = samples.get(n);
				const moves = list => list.some(a => a.some((x, i) => Math.abs(x - list[0][i]) > 1e-4) || a.some(x => Math.abs(x) > 1e-4));
				const channels = [['rotation', s.rot, 0.15, moves(s.rot)], ['position', s.pos, 0.01, moves(s.pos)], ['scale', s.scl, 0.002, s.scl.some(a => a.some(x => Math.abs(x - 1) > 1e-3))]];
				if (!channels.some(c => c[3])) continue;
				const animator = animation.getBoneAnimator(target);
				if (!animator) continue;
				for (const [channel, list, tol, used] of channels) {
					if (!used) continue;
					for (const f of reduceKeys(list, tol)) {
						const a = list[f];
						animator.addKeyframe({channel, time: r4(f / fps), interpolation: 'linear', data_points: [{x: r4(a[0]), y: r4(a[1]), z: r4(a[2])}]});
					}
				}
			}
			animations.push(animation);
		}
		mixer.uncacheRoot(root);
	}
	restore();
	return {top, groups, elements, textures: bank.created, animations, bone_count, armature};
}

// ---------------------------------------------------------------------------
// The import: pick files, options, read, convert
// ---------------------------------------------------------------------------

const Z_UP_FORMATS = ['3ds', 'stl', '3mf'];
const DEFAULT_OPTIONS = {up: 'auto', size: 'fit', height: 32, factor: 1, ground: true, animations: true, textures: true, quads: true, skin: 'auto', fps: 30, target: 'new'};
let last_options = Object.assign({}, DEFAULT_OPTIONS);
try { Object.assign(last_options, JSON.parse(localStorage.getItem('model_import_options') || '{}')); } catch (err) { /* defaults */ }

function pickFiles() {
	Blockbench.import({
		resource_id: 'model_import',
		extensions: [...MODEL_EXT, ...RESOURCE_EXT],
		type: '3D model',
		readtype: 'binary',
		multiple: true,
	}, files => {
		const list = files.map(f => ({name: f.name || baseOf(f.path || 'model'), path: f.path, buffer: f.content instanceof ArrayBuffer ? f.content : (f.content && f.content.buffer) || f.content}));
		const main = list.find(f => MODEL_EXT.includes(extOf(f.name)) && !/t\.mdl$/i.test(f.name) && !/\d\d\.mdl$/i.test(f.name)) || list.find(f => MODEL_EXT.includes(extOf(f.name)));
		if (!main) { Blockbench.showQuickMessage(tr('unknown'), 3000); return; }
		optionsDialog(main, list);
	});
}

function optionsDialog(main, files) {
	const o = last_options;
	const has_project = typeof Project != 'undefined' && Project && Format && Format.meshes;
	new Dialog({
		id: 'model_import_options',
		title: tr('title') + ' — ' + main.name,
		width: 480,
		form: {
			files: {type: 'info', label: tr('files'), text: files.map(f => f.name).join(', ')},
			target: {label: tr('target'), type: 'select', value: has_project ? o.target : 'new', options: has_project ? {new: tr('target_new'), current: tr('target_current')} : {new: tr('target_new')}},
			size: {label: tr('size'), type: 'select', value: o.size, options: {fit: tr('size_fit'), keep: tr('size_keep')}},
			height: {label: tr('height'), type: 'number', value: o.height, min: 1, max: 4096, step: 1, condition: f => f.size == 'fit'},
			factor: {label: tr('factor'), type: 'number', value: o.factor, min: 0.0001, max: 10000, step: 0.1, condition: f => f.size == 'keep'},
			up: {label: tr('up'), type: 'select', value: o.up || 'auto', options: {auto: tr('up_auto'), y: tr('up_y'), z: tr('up_z')}},
			ground: {label: tr('ground'), type: 'checkbox', value: o.ground},
			textures: {label: tr('textures'), type: 'checkbox', value: o.textures},
			quads: {label: tr('quads'), type: 'checkbox', value: o.quads},
			skin: {label: tr('skin'), type: 'select', value: o.skin, options: {auto: tr('skin_auto'), groups: tr('skin_groups'), armature: tr('skin_armature')}},
			animations: {label: tr('anims'), type: 'checkbox', value: o.animations},
			fps: {label: tr('fps'), type: 'number', value: o.fps, min: 1, max: 120, step: 1, condition: f => f.animations},
			hint: {type: 'info', text: tr('hint')},
		},
		onConfirm(form) {
			last_options = Object.assign({}, DEFAULT_OPTIONS, form);
			try { localStorage.setItem('model_import_options', JSON.stringify(last_options)); } catch (err) { /* not kept */ }
			runImport(main, files, last_options);
		},
	}).show();
}

async function runImport(main, files, o) {
	const notes = [];
	const res = new Resources(files.filter(f => f !== main), main);
	let result = null;
	try {
		Blockbench.setProgress && Blockbench.setProgress(0.1);
		let {root, clips} = await loadModel(main, res, notes);
		if (!root) throw new Error(tr('no_mesh'));
		// a model made with Z up (CAD, 3ds Max) is stood up
		const z_up = o.up == 'z' || (o.up == 'auto' && Z_UP_FORMATS.includes(extOf(main.name)));
		if (z_up) { const turn = new THREE.Group(); turn.rotation.x = -Math.PI / 2; turn.add(root); root = turn; }
		Blockbench.setProgress && Blockbench.setProgress(0.5);
		if (o.target != 'current' || !Project || !Format || !Format.meshes) {
			newProject(Formats.free || Formats.generic || Object.values(Formats).find(f => f.meshes));
			Project.name = main.name.replace(/\.[^.]*$/, '');
		}
		const undo = {outliner: true, elements: [], selection: true, textures: [], animations: []};
		Undo.initEdit(undo);
		try {
			result = convertScene(root, clips, o, main.name, notes, res);
		} catch (err) {
			Undo.cancelEdit && Undo.cancelEdit();
			throw err;
		}
		Undo.finishEdit('Import 3D model', {outliner: true, elements: result.elements, selection: true, textures: result.textures, animations: result.animations});
		if (typeof Canvas != 'undefined') { Canvas.updateAll && Canvas.updateAll(); }
		result.textures.forEach(t => { try { t.updateMaterial && t.updateMaterial(); } catch (err) { /* later */ } });
		if (typeof updateInterface == 'function') updateInterface();
		if (typeof Animator != 'undefined' && result.animations.length && Animation.all) { /* the animations are in the Animate tab */ }
		Blockbench.showQuickMessage(fill(tr('done'), main.name, result.elements.length, result.bone_count, result.animations.length), 4000);
	} catch (err) {
		console.error('[Import]', err);
		Blockbench.showMessageBox({title: tr('failed'), message: String(err && err.message || err), icon: 'error'});
	} finally {
		Blockbench.setProgress && Blockbench.setProgress(0);
		res.dispose();
	}
	if (notes.length) Blockbench.showMessageBox({title: tr('title'), message: notes.map(n => '• ' + n).join('\n\n'), icon: 'info'});
	return result;
}

// ---------------------------------------------------------------------------

let import_action = null;

if (typeof __IMPORT_EXPORT !== 'undefined') __IMPORT_EXPORT({L, loadModel, convertScene, parseGoldSrc, parseQuake, Resources, mergeQuads, reduceKeys, runImport, hlQuat, TextureBank});

Plugin.register('model_import', {
	title: 'Model import',
	author: 'Claude',
	description: 'Import 3D models with textures, skeleton and animations: OBJ (+MTL), FBX, glTF/GLB, Collada, 3DS, STL, PLY, 3MF, MD2, Half-Life and Quake MDL.',
	about: 'File > Import > **3D model**. Pick the model (and its textures, .mtl or .bin if Blockbench cannot read its folder). The geometry becomes mesh elements, the textures and material colours become textures, a skeleton becomes bone groups (or an armature with vertex weights in Blockbench 5 for smooth skins), and every animation of the file becomes a Blockbench animation. Uses the three.js r129 loaders (MIT).',
	icon: 'file_download',
	version: '0.1.0',
	variant: 'both',
	min_version: '4.10.0',
	tags: ['Import'],
	onload() {
		import_action = new Action('import_3d_model', {
			name: tr('action'), description: tr('action_desc'), icon: 'view_in_ar', category: 'file',
			click() { pickFiles(); },
		});
		try { MenuBar.addAction(import_action, 'file.import'); } catch (err) { MenuBar.addAction(import_action, 'file'); }
	},
	onunload() {
		if (import_action) {
			try { MenuBar.removeAction('file.import.import_3d_model'); } catch (err) { /* not there */ }
			try { MenuBar.removeAction('file.import_3d_model'); } catch (err) { /* not there */ }
			import_action.delete();
			import_action = null;
		}
	},
});

})();
