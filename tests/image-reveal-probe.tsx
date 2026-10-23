import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PrivateImage} from '../src/components/PrivateImage';
import {ImageLightbox} from '../src/components/ImageLightbox';
import {setImageCacheOwner, writeCachedImage} from '../src/lib/imageCache';
import '../src/index.css';
const w=window as any;
w.decoded=[]; w.holds=[];
const native=HTMLImageElement.prototype.decode;
HTMLImageElement.prototype.decode=function(){const image=this;return native.call(this).then(()=>w.holdDecode?new Promise<void>((resolve,reject)=>w.holds.push({image,resolve,reject})):undefined);};
function Probe(){const [props,setProps]=useState<any>({src:'/api/images/one',variant:'display'});const [index,setIndex]=useState(-1);w.select=setProps;w.lightbox=setIndex;
return <><div style={{width:'100%',height:200}}><PrivateImage {...props} className="h-full w-full" alt="probe" onDecoded={()=>w.decoded.push(props.src+'|'+(props.localSrc||'')+'|'+props.variant)}/></div>{index>=0&&<ImageLightbox images={['/api/images/one','/api/images/two','/api/images/three']} currentIndex={index} isOpen onClose={()=>setIndex(-1)} onNavigate={setIndex}/>}<button className="ui-action" id="action">Action</button></>;}
w.init=async()=>{setImageCacheOwner('decode-probe');const blob=await (await fetch('/fixture.svg')).blob();w.local=URL.createObjectURL(blob);await writeCachedImage('decode-probe','cached','display',blob);createRoot(document.getElementById('root')!).render(<React.StrictMode><Probe/></React.StrictMode>);};
w.init();
