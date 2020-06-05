export default async (pixels, w, h, onProgress)=>{
	return new Promise(res=>{
		let thread = new Worker('./image-patch-thread.js',{type:'module'});
		thread.onmessage = msg=>{
			if(msg.data.done){
				res(msg.data.pixels);
			}else if(onProgress){
				onProgress(msg.data.pixels);
			}
		};
		thread.postMessage({
			pixels: pixels,
			width: w,
			height: h
		});
	})
};
