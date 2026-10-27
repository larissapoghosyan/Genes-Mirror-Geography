/* Geometry and camera from the supplied Europe-to-DNA SVG; the document owns scrolling. */
(function(root){
  'use strict';
  const clamp=x=>Math.max(0,Math.min(1,x));
  const ease=x=>{const t=clamp(x);return t*t*(3-2*t);};
  const lerp=(a,b,t)=>a+(b-a)*t;
  const stops=[2,2.32,2.65,3.05,3.40,3.75,4.05,4.30,4.60];
  function project(lon,lat,projection){
    const radians=Math.PI/180,[lon0,lat0]=projection.center;
    function raw(lon,lat){
      const p0=lat0*radians,p=lat*radians,d=(lon-lon0)*radians;
      const k=Math.sqrt(2/(1+Math.sin(p0)*Math.sin(p)+Math.cos(p0)*Math.cos(p)*Math.cos(d)));
      return [projection.radius*k*Math.cos(p)*Math.sin(d),-projection.radius*k*(Math.cos(p0)*Math.sin(p)-Math.sin(p0)*Math.cos(p)*Math.cos(d))];
    }
    const point=raw(lon,lat),origin=raw(...(projection.focus||projection.anchor));
    return [point[0]-origin[0],point[1]-origin[1]];
  }
  function register(atlas,projection){
    if(!atlas||!projection)return null;
    const [lon,lat]=atlas.center,center=project(lon,lat,projection),east=project(lon+.001,lat,projection);
    const dx=east[0]-center[0],dy=east[1]-center[1];
    const angle=-Math.atan2(dy,dx),scale=atlas.scale*atlas.longitudeFactor*.001/Math.hypot(dx,dy);
    const c=Math.cos(angle),s=Math.sin(angle);
    return {angle,scale,center,px:atlas.area.cx-scale*(c*center[0]-s*center[1]),py:atlas.area.cy-scale*(s*center[0]+c*center[1])};
  }
  function create(svg,parent,payload){
    const doc=svg.ownerDocument||document,nodes=new Map(),r=payload.route;
    // One evenly spread cell per screen-scale bin keeps the tissue recognizable
    // without asking SVG to draw hundreds of overlapping detailed templates.
    const cellPitch=(root.innerWidth||1440)<=900?240:200,cellBins=new Map();
    function selectCells([,attrs,,children]){
      if(attrs.id?.startsWith('pkg-neighbor-')){
        const match=attrs.transform?.match(/translate\(([-\d.]+),([-\d.]+)\)/);
        if(match){
          const x=Number(match[1]),y=Number(match[2]);
          if(Math.hypot(x,y)>=110){
            const bx=Math.floor(x/cellPitch),by=Math.floor(y/cellPitch),key=`${bx}:${by}`;
            const score=(x-(bx+.5)*cellPitch)**2+(y-(by+.5)*cellPitch)**2;
            if(!cellBins.has(key)||score<cellBins.get(key).score)cellBins.set(key,{id:attrs.id,score});
          }
        }
      }
      for(const child of children||[])selectCells(child);
    }
    selectCells(payload.camera);
    const selectedCells=new Set([...cellBins.values()].map(entry=>entry.id));
    function build([tag,attrs,text,children],parent){
      if(attrs.id?.startsWith('pkg-neighbor-')&&!selectedCells.has(attrs.id))return null;
      const node=doc.createElementNS('http://www.w3.org/2000/svg',tag);
      for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
      if(attrs.id)nodes.set(attrs.id,node);
      if(text)node.textContent=text;
      parent.appendChild(node);children.forEach(child=>build(child,node));return node;
    }
    const group=build(['g',{id:'bio-package-art','font-family':'Inter, Arial, sans-serif'},'',[]],parent);
    const defsNode=build(payload.defs,group);const camera=build(payload.camera,group);
    const node=id=>nodes.get('pkg-'+id);
    const grad=doc.createElementNS('http://www.w3.org/2000/svg','linearGradient');
    grad.setAttribute('id','pkg-east-fade-grad');grad.setAttribute('gradientUnits','userSpaceOnUse');
    grad.setAttribute('x1','190');grad.setAttribute('y1','0');grad.setAttribute('x2','485');grad.setAttribute('y2','0');
    for(const [offset,opacity] of [['0%','1'],['30%','1'],['65%','0.60'],['100%','0.05']]){
      const stop=doc.createElementNS('http://www.w3.org/2000/svg','stop');
      stop.setAttribute('offset',offset);stop.setAttribute('stop-color','#ffffff');stop.setAttribute('stop-opacity',opacity);
      grad.appendChild(stop);
    }
    defsNode.appendChild(grad);
    const mask=doc.createElementNS('http://www.w3.org/2000/svg','mask');
    mask.setAttribute('id','pkg-east-fade-mask');mask.setAttribute('maskUnits','userSpaceOnUse');
    mask.setAttribute('x','-800');mask.setAttribute('y','-800');mask.setAttribute('width','1600');mask.setAttribute('height','1600');
    const maskWest=doc.createElementNS('http://www.w3.org/2000/svg','rect');
    maskWest.setAttribute('x','-800');maskWest.setAttribute('y','-800');maskWest.setAttribute('width','990');maskWest.setAttribute('height','1600');maskWest.setAttribute('fill','#ffffff');
    mask.appendChild(maskWest);
    const maskEast=doc.createElementNS('http://www.w3.org/2000/svg','rect');
    maskEast.setAttribute('x','190');maskEast.setAttribute('y','-800');maskEast.setAttribute('width','610');maskEast.setAttribute('height','1600');maskEast.setAttribute('fill','url(#pkg-east-fade-grad)');
    mask.appendChild(maskEast);
    defsNode.appendChild(mask);
    const surface=node('europe-surface');if(surface)surface.setAttribute('mask','url(#pkg-east-fade-mask)');
    const landmarksGroup=node('europe-landmarks');if(landmarksGroup)landmarksGroup.style.display='none';
    const landmarksLayer=node('landmarks');if(landmarksLayer)landmarksLayer.style.display='none';
    const originShift=node('map-origin-shift');if(originShift)originShift.setAttribute('transform','translate(10.132,46.471)');
    r.names[1]='Northern Italy';
    const dx=88.0,dy=-36.0;
    const geoBounds=r.geo.map(c=>[c.bounds[0]+dx,c.bounds[1]+dy,c.bounds[2]+dx,c.bounds[3]+dy]);
    const attribute=(target,key)=>target.getAttribute?target.getAttribute(key):target.attrs[key];
    const show=(id,visible)=>{const n=node(id);if(n)n.style.display=visible?'inline':'none';};
    const mapPaths=r.geo.map(country=>node('country-path-'+country.code));
    const originalPaths=mapPaths.map(path=>attribute(path,'d'));
    const countryVertices=originalPaths.map(d=>(d.match(/M\s*[^Z]+Z/g)||[]).map(ring=>
      Float64Array.from((ring.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number))));
    // Round the drawn map corners while keeping the source vertices unchanged for
    // camera projection and culling. Each corner gets a short quadratic arc.
    const round=v=>Math.round(v*10000)/10000;
    const roundedRings=countryVertices.map(rings=>rings.map(ring=>{
        const count=ring.length/2;
        const corners=[];
        for(let i=0;i<count;i++){
          const x=ring[2*i],y=ring[2*i+1];
          const prev=(i+count-1)%count,next=(i+1)%count;
          const px=ring[2*prev],py=ring[2*prev+1],nx=ring[2*next],ny=ring[2*next+1];
          const before=Math.hypot(px-x,py-y),after=Math.hypot(nx-x,ny-y);
          const radius=Math.min(1.4,before*.22,after*.22);
          const entry=before?[x+(px-x)*radius/before,y+(py-y)*radius/before]:[x,y];
          const exit=after?[x+(nx-x)*radius/after,y+(ny-y)*radius/after]:[x,y];
          corners.push({entry,tip:[x,y],exit});
        }
        return corners;
    }));
    function roundedCountry(rings,project){
      const parts=[];
      for(const corners of rings){
        const count=corners.length;
        if(count<3)continue;
        const pair=point=>`${round(point[0])},${round(point[1])}`;
        parts.push(`M${pair(project(...corners[0].exit))}`);
        for(let i=1;i<=count;i++){
          const corner=corners[i%count];
          parts.push(`L${pair(project(...corner.entry))}Q${pair(project(...corner.tip))} ${pair(project(...corner.exit))}`);
        }
        parts.push('Z');
      }
      return parts.join('');
    }
    const flatPaths=roundedRings.map(rings=>roundedCountry(rings,(x,y)=>[x,y]));
    mapPaths.forEach((path,i)=>path.setAttribute('d',flatPaths[i]));
    const labels=r.countryLabelCodes.map(code=>node('country-label-'+code));
    labels.forEach(l=>{if(l)l.style.display='none';});
    const landmarks=r.landmarks.map(l=>node('landmark-'+l.id));
    landmarks.forEach(l=>{if(l)l.style.display='none';});
    const originalLandmarkTransforms=landmarks.map(n=>attribute(n,'transform'));
    const countryPitch=r.geo.map(()=>1),labelPitch=labels.map(()=>1),landmarkPitch=landmarks.map(()=>1);
    let titlePitch=1,lastBlendT=-1;
    function parseHex(c){
      if(!c||c[0]!=='#')return [227,231,227];
      if(c.length===4)return [parseInt(c[1]+c[1],16),parseInt(c[2]+c[2],16),parseInt(c[3]+c[3],16)];
      return [parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
    }
    function blendDaylight(hex,t){
      if(t<=0)return hex;
      if(t>=1)return '#fff6e5';
      const [r,g,b]=parseHex(hex);
      const rN=Math.round(r+(255-r)*t),gN=Math.round(g+(246-g)*t),bN=Math.round(b+(229-b)*t);
      return '#'+((1<<24)+(rN<<16)+(gN<<8)+bN).toString(16).slice(1);
    }
    function colorCountries(blendT=0){
      const bKey=Math.round(blendT*1000);
      if(bKey===lastBlendT)return;
      lastBlendT=bKey;
      r.geo.forEach((country,i)=>{
        const fill=blendDaylight('#fde6a8',blendT),path=mapPaths[i];
        if(path){
          path.setAttribute('fill',fill);
          path.setAttribute('stroke','#ddca9d');
          path.setAttribute('stroke-opacity',(1-blendT).toFixed(3));
          path.setAttribute('stroke-width','1.05');
          path.setAttribute('stroke-linecap','round');
          path.setAttribute('stroke-linejoin','round');
        }
      });
    }
    const projectMap=(x,y,pitch)=>{
      const sin=Math.sqrt(Math.max(0,1-pitch*pitch)),f=1/(1-y*sin/r.mapPerspective);
      return [x*f,y*pitch*f];
    };
    function warpMap(pitch){
      const sin=Math.sqrt(Math.max(0,1-pitch*pitch)),[ox,oy]=[-10.132,-46.471];
      r.geo.forEach((country,i)=>{
        if(node('country-'+country.code).style.display==='none'||Math.abs(pitch-countryPitch[i])<1e-8)return;
        if(pitch===1){mapPaths[i].setAttribute('d',flatPaths[i]);countryPitch[i]=1;return;}
        const projected=(x,y)=>{
          x-=ox;y-=oy;
          const f=1/(1-y*sin/r.mapPerspective);
          return [x*f+ox,y*pitch*f+oy];
        };
        mapPaths[i].setAttribute('d',roundedCountry(roundedRings[i],projected));countryPitch[i]=pitch;
      });
      function textMatrix(target,x,y){
        const wx=x-ox,wy=y-oy,f=1/(1-wy*sin/r.mapPerspective);
        const vy=pitch*f*f,shear=wx*sin/r.mapPerspective*f*f;
        const px=wx*f+ox,py=wy*pitch*f+oy;
        target.setAttribute('transform',`matrix(${f} 0 ${shear} ${vy} ${px-f*x-shear*y} ${py-vy*y})`);
      }
      labels.forEach((label,i)=>{
        if(label.style.display==='none'||Math.abs(pitch-labelPitch[i])<1e-8)return;
        const [x,y]=r.countryLabelPositions[i];textMatrix(label,x,y);labelPitch[i]=pitch;
      });
      const title=node('map-title');
      if(title.style.display!=='none'&&Math.abs(pitch-titlePitch)>=1e-8){
        textMatrix(title,...r.mapTitlePosition);titlePitch=pitch;
      }
      landmarks.forEach((target,i)=>{
        if(target.style.display==='none'||Math.abs(pitch-landmarkPitch[i])<1e-8)return;
        if(pitch===1){target.setAttribute('transform',originalLandmarkTransforms[i]);landmarkPitch[i]=1;return;}
        const l=r.landmarks[i],f=1/(1-(l.y+dy)*sin/r.mapPerspective),vy=pitch*f*f,shear=(l.x+dx)*sin/r.mapPerspective*f*f;
        target.setAttribute('transform',`matrix(${f} 0 ${shear} ${vy} ${(l.x+dx)*f+ox} ${(l.y+dy)*pitch*f+oy})`);
        landmarkPitch[i]=pitch;
      });
    }
    const scales=[r.personScale];
    for(let i=1;i<r.levels.length;i++)scales.push(scales[i-1]*r.levels[i].s);
    let lastKey='',lastResult;
    function render(position,area,reduced=false,frame={width:area.cx+area.w/2,height:area.cy+area.h/2}){
      const alpha=reduced?(position<4.65?1:0):1-ease((position-4.02)/.63);
      group.setAttribute('opacity',alpha);
      if(!alpha){group.style.display='none';lastKey='';return {alpha,stage:8,name:r.names[8]};}
      group.style.display='inline';
      let q=position;
      if(reduced)q=stops.filter(v=>v<=q+1e-6).at(-1)||2;
      const key=[q,area.cx,area.cy,area.w,area.h,frame.width,frame.height,frame.atlas?.scale,
        frame.atlas?.area.cx,frame.atlas?.area.cy,frame.atlas?.center[0],frame.atlas?.center[1],frame.atlas?.longitudeFactor,
        frame.depthProgress,lastBlendT].join('/');
      if(key===lastKey)return {...lastResult,alpha};lastKey=key;
      const registration=register(frame.atlas,r.projection);
      const W=area.w,H=area.h;
      const eastFit=(frame.width-(registration?.px??area.cx))/490.5;
      const autoFit=Math.min(W/r.mapView.width,H/r.mapView.height)*.9;
      const fitScale=registration?.scale||Math.max(autoFit,eastFit);
      const bodyFit=Math.min(W/r.bodyView.width,H/r.bodyView.height)*.94;
      const parkFit=Math.min(W/r.parkView.width,H/r.parkView.height)*.94;
      const hungaryZoom=Math.min(W/120,H/60)*.88;
      const outline=Math.log(parkFit/(r.personScale*fitScale)),gain=Math.log(bodyFit/parkFit);
      // Frame Europe at twice the previous opening scale; the following stops
      // keep their existing magnification and the scroll fills the new range.
      const depths=[Math.log(2),Math.log(hungaryZoom/fitScale),outline,outline+1];
      for(let i=1;i<r.levels.length;i++)depths.push(1+Math.log((i===5?.68:.42)*H/(fitScale*scales[i]*r.levels[i].rho))-gain);
      let depth=depths[8],stage=8;
      for(let i=1;i<stops.length;i++)if(q<=stops[i]){
        const u=clamp((q-stops[i-1])/(stops[i]-stops[i-1]));
        const t=.3*u+.7*ease(u);
        depth=lerp(depths[i-1],depths[i],t);stage=t<.5?i-1:i;break;
      }
      let uniformLogZoom=null;
      if(!reduced&&Number.isFinite(frame.depthProgress)){
        // Keep log(camera scale) linear in actual scroll travel. Invert the
        // package's anatomy scale handoff to retain its biological landmarks.
        const minLog=depths[0],maxLog=depths[8]+gain-1;
        uniformLogZoom=minLog+clamp(frame.depthProgress)*(maxLog-minLog);
        depth=uniformLogZoom<=outline?uniformLogZoom:
          uniformLogZoom<=outline+gain?outline+(uniformLogZoom-outline)/gain:
          uniformLogZoom-(gain-1);
        stage=0;
        for(let i=1;i<depths.length;i++)if(depth>=(depths[i-1]+depths[i])/2)stage=i;
      }
      const tSurround=clamp((depth-6.30)/Math.max(0.01,outline-6.30));
      const blendT=ease(tSurround);
      const reveal=clamp(depth-outline),smoothReveal=reveal*reveal*reveal*(reveal*(reveal*6-15)+10);
      const z=fitScale*Math.exp(uniformLogZoom??depth+smoothReveal*(gain-1));
      const uHungary=clamp((depth-depths[0])/Math.max(.01,depths[1]-depths[0]));
      const uPark=clamp((depth-depths[1])/Math.max(.01,outline-depths[1]));
      const tilt=0.5*ease(uHungary)+0.5*ease(uPark);
      const mapPitch=Math.cos(Math.acos(r.finalMapPitch)*tilt);
      // The heart, cell nucleus and SNP share world origin. Frame that point
      // from the opening Europe view onward; scroll changes only magnification.
      const cx=0,cy=0;
      const px=(registration?.px??area.cx),py=registration?.py??area.cy,angle=registration?.angle||0;
      camera.setAttribute('transform',`translate(${px},${py})${registration?` rotate(${angle*180/Math.PI})`:''} scale(${z})`);
      // The SVG's conservative culling is essential for its microscopic pattern tiles.
      const far=Math.hypot(Math.max(Math.abs(px),Math.abs(frame.width-px)),Math.max(Math.abs(py),Math.abs(frame.height-py)))+2;
      const s=scales.map(v=>v*z);
      r.levels.forEach((l,i)=>show(l.id,i<5&&s[i]*r.bounds[i]>=.25));
      // The supplied DNA tile is hidden in favor of the upright helix. It must
      // therefore never cull the chromosome that the new helix fades out of.
      const dna=false,nucleus=s[3]*399>far,cell=s[2]*32>far,tissue=false,heart=s[1]*16>far;
      const ancestor=!(dna||nucleus||cell||tissue||heart),b=r.parkBackgroundBounds;
      const cosine=Math.cos(angle),sine=Math.sin(angle);
      const corners=[[0,0],[frame.width,0],[0,frame.height],[frame.width,frame.height]].map(([x,y])=>[(x-px)*cosine+(y-py)*sine,-(x-px)*sine+(y-py)*cosine]);
      const left=Math.min(...corners.map(p=>p[0])),right=Math.max(...corners.map(p=>p[0]));
      const top=Math.min(...corners.map(p=>p[1])),bottom=Math.max(...corners.map(p=>p[1]));
      const tileCover=s[0]*b[0]<=left-2&&s[0]*b[1]<=top-2&&s[0]*b[2]>=right+2&&s[0]*b[3]>=bottom+2;
      const mapVisible=ancestor&&!tileCover;
      ['map-plane','europe-surface','hungary-surface'].forEach(id=>show(id,mapVisible));
      show('landmarks',false);show('europe-landmarks',false);
      show('map-title',mapVisible&&z<fitScale*3.6);
      const personFieldVisible=ancestor&&s[0]*3600>=.25,parkSurfaceVisible=ancestor&&s[0]*2400>=.25;
      show('person-field',personFieldVisible);show('park-surface',parkSurfaceVisible);
      show('park-visual',personFieldVisible||parkSurfaceVisible);
      show('tissue-cell-field',s[2]*96>=.25&&s[2]*32<=far);
      show('cell-organelles',s[2]>=.08);
      if(mapVisible){
        colorCountries(blendT);
        for(let i=0;i<r.geo.length;i++){
          const b=geoBounds[i],pad=(z<fitScale*4?25:8)*z+2;
          const corners=[[b[0],b[1]],[b[0],b[3]],[b[2],b[1]],[b[2],b[3]]].map(([x,y])=>projectMap(x,y,mapPitch));
          const loX=Math.min(b[0],...corners.map(p=>p[0])),hiX=Math.max(b[2],...corners.map(p=>p[0]));
          const loY=Math.min(b[1]*mapPitch,...corners.map(p=>p[1])),hiY=Math.max(b[3]*mapPitch,...corners.map(p=>p[1]));
          show('country-'+r.geo[i].code,z*hiX+pad>=left&&z*loX-pad<=right&&z*hiY+pad>=top&&z*loY-pad<=bottom);
        }
        r.countryLabelCodes.forEach(code=>show('country-label-'+code,false));
        for(const l of r.landmarks)show('landmark-'+l.id,false);
      }
      if(mapVisible)warpMap(mapPitch);
      const drawn=[ancestor,ancestor,!(dna||nucleus||cell||tissue),!(dna||nucleus||cell),!(dna||nucleus),!dna,!dna];
      ['body-surface','anatomy-surface','heart-surface','tissue-surface','cell-surface','nucleus-surface','chromosome-surface'].forEach((id,i)=>show(id,drawn[i]));
      // The repeated tissue field has hundreds of SVG nodes. By the time the
      // nucleus fills the view it contributes no useful detail, so fade and
      // cull it before the chromosome close-up.
      const tissueFade=1-ease((q-3.73)/.23);
      node('tissue-surface').setAttribute('opacity',tissueFade);
      if(tissueFade<.001)show('tissue-surface',false);
      node('opening-anatomy').setAttribute('opacity',ease(reveal));
      node('body-surface').setAttribute('opacity',1-.88*ease(reveal));
      group.setAttribute('data-package-stage',stage);group.setAttribute('data-package-depth',depth);
      group.setAttribute('data-package-magnification',z/fitScale);
      const note=stage<3?'Illustrated geography · not the genetic PCA result':
        stage<5?'Illustrative anatomy · not the study’s sampling route':'Biological scales and condensed chromosomes are schematic';
      return lastResult={alpha,stage,name:r.names[stage],note,depth,depths,registration,mapPitch,camera:{z,x:cx,y:cy}};
    }
    return {render,group,camera};
  }
  root.BioRoute={create,stops,project};
})(typeof window==='undefined'?globalThis:window);
