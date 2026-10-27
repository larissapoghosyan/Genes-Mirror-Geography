const assert=require('node:assert/strict');
const {create}=require('../js/helix-geometry.js');
let checked=0,maxMidpointError=0,maxChordLengthError=0,minAxisDistance=Infinity;
for(const radius of [58,127,318])for(const phase of [0,.17,Math.PI/2,2.71,8])for(const tilt of [0,.14,.32]){
  const model=create({radius,length:700,phase,tilt});
  let visiblyOffset=0;
  model.rungs.forEach((rung,i)=>{
    assert.strictEqual(rung.left,model.strands[0][i*12]);
    assert.strictEqual(rung.right,model.strands[1][i*12]);
    const l=rung.left.world,r=rung.right.world,m=rung.center.world;
    for(const endpoint of [rung.left,rung.right]){
      for(const p of [endpoint.world,...endpoint.edges.map(edge=>edge.world)]){
        assert(Math.abs(Math.hypot(p.x,p.z)-radius)<1e-10,'Backbone or ribbon edge leaves the cylinder surface');
        assert.equal(p.y,endpoint.world.y,'Ribbon width changes its axial level');
      }
    }
    const chordLength=Math.hypot(l.x-r.x,l.y-r.y,l.z-r.z);
    maxChordLengthError=Math.max(maxChordLengthError,Math.abs(chordLength-Math.sqrt(3)*radius));
    assert(Math.abs(chordLength-Math.sqrt(3)*radius)<1e-9,'Rung length disagrees with the strand spacing');
    assert(chordLength<2*radius,'The offset chord has reverted to a diameter');
    const axisDistance=Math.hypot(m.x,m.z);minAxisDistance=Math.min(minAxisDistance,axisDistance);
    assert(Math.abs(axisDistance-radius/2)<1e-9,'Rung midpoint must wind around the axis at a fixed, nonzero distance');
    assert(Math.hypot(m.x-(l.x+r.x)/2,m.y-(l.y+r.y)/2,m.z-(l.z+r.z)/2)<1e-9,'Rung halves do not meet at their actual midpoint');
    const error=Math.hypot((rung.left.x+rung.right.x)/2-rung.center.x,
      (rung.left.y+rung.right.y)/2-rung.center.y);
    maxMidpointError=Math.max(maxMidpointError,error);
    assert(error<1e-9,'Projected midpoint is not the midpoint of the straight chord');
    if(Math.hypot(rung.center.x-rung.axis.x,rung.center.y-rung.axis.y)>1e-6)visiblyOffset++;
    checked++;
  });
  assert(visiblyOffset>model.rungs.length/2,'The drawn ladder has reverted to axis-centered rungs');
}
const frontView=create({radius:95,length:636,pairs:19,turns:1.75,tilt:0});
for(const rung of frontView.rungs)assert.equal(rung.left.y,rung.right.y,'Reference-view rungs must remain horizontal');
console.log(JSON.stringify({checked,constantCylinderRadius:'PASS',offsetChordRungs:'PASS',sharedBackboneEndpoints:'PASS',midpointsWindAroundAxis:'PASS',maxMidpointError,maxChordLengthError,minAxisDistance},null,2));
