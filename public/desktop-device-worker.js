/* global Vision */
// On-device inference only. The worker response CSP forbids external connections.
importScripts('/api/models/device/vision_bundle.js');
let detector;
let crop;
let context;
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'load') {
      const files = await Vision.FilesetResolver.forVisionTasks('/api/models/device');
      detector = await Vision.ObjectDetector.createFromOptions(files, {
        baseOptions: {modelAssetPath:'/api/models/device/model.tflite',delegate:'CPU'},
        runningMode:'IMAGE',scoreThreshold:0.5,maxResults:10,canvas:new OffscreenCanvas(1,1),
      });
      self.postMessage({id:data.id,loaded:true});
    } else if (data.type === 'detect') {
      try {
        const frame = data.frame;
        const predictions = [];
        const add = image => predictions.push(...detector.detect(image).detections.flatMap(d=>d.categories.map(c=>({class:c.categoryName,score:c.score}))));
        const actionable = () => predictions.some(p=>p.score>=({'cell phone':.5,remote:.55,laptop:.65}[p.class]??2));
        add(frame);
        // Use original camera detail; a 480px face buffer loses small devices.
        if (!actionable() && frame.width !== frame.height) {
          const size = Math.min(frame.width,frame.height);
          crop ??= new OffscreenCanvas(size,size);
          if(crop.width!==size||crop.height!==size){crop.width=size;crop.height=size;}
          context ??= crop.getContext('2d');
          const positions = frame.width>frame.height ? [[0,0],[frame.width-size,0]] : [[0,0],[0,frame.height-size]];
          for(const [x,y] of positions){
            context.drawImage(frame,x,y,size,size,0,0,size,size);
            add(crop);
            if(actionable())break;
          }
        }
        self.postMessage({id:data.id,predictions});
      } finally {data.frame.close();}
    }
  } catch {self.postMessage({id:data.id,error:true});}
};
