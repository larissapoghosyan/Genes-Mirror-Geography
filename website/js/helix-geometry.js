/* Schematic double helix with unequal backbone spacing and offset chord rungs. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.DNAHelix=factory();
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  function create({radius,length,pairs=26,turns=2.5,phase=0,tilt=8*Math.PI/180,
    strandSeparation=2*Math.PI/3,ribbonHalfAngle=.09}){
    const cos=Math.cos(tilt),sin=Math.sin(tilt),steps=(pairs-1)*12;
    const project=p=>({x:p.x,y:p.y*cos-p.z*sin,depth:p.y*sin+p.z*cos});
    const axis=t=>project({x:0,y:(t-.5)*length,z:0});
    const strands=[-1,1].map(side=>Array.from({length:steps+1},(_,i)=>{
      // 120 degrees is an illustrative spacing, not an atomistic measurement.
      // Unequal arcs between the backbones leave a wide and a narrow groove.
      const t=i/steps,angle=t*turns*2*Math.PI+phase+side*strandSeparation/2;
      const world={x:radius*Math.cos(angle),y:(t-.5)*length,z:radius*Math.sin(angle)};
      const edges=[-1,1].map(sign=>{
        const theta=angle+sign*ribbonHalfAngle;
        const p={x:radius*Math.cos(theta),y:world.y,z:radius*Math.sin(theta)};
        return {...project(p),world:p};
      });
      return {...project(world),world,edges};
    }));
    // Rungs refer to actual backbone vertices, so their joins cannot drift apart.
    const rungs=Array.from({length:pairs},(_,i)=>{
      const left=strands[0][i*12],right=strands[1][i*12];
      const world={x:(left.world.x+right.world.x)/2,y:(left.world.y+right.world.y)/2,
        z:(left.world.z+right.world.z)/2};
      return {left,right,center:{...project(world),world},axis:axis(i/(pairs-1))};
    });
    return {radius,length,strandSeparation,ribbonHalfAngle,strands,rungs,axis,project};
  }
  return {create};
});
