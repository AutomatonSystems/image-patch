let chunkDims = [1,2];
let chunkSize = (2*chunkDims[0]+1)*(2*chunkDims[1]+1);

const MAX_DIST = 1;

const SCALEDOWN = 200_000;

const SAMPLING_CHANCE = 1;
const CHUNK_DEDUPE_DIST = 0;//0.005;

//let grid = null;
onmessage = async (msg)=>{

	let patcher = new ImagePatch(msg.data.pixels);
	let p = null;
	patcher.patch((pixels)=>{
		p = pixels;
		postMessage({
			pixels: pixels,
			done: false
		},null);
	});

	postMessage({
		pixels: p,
		done: true
	},null);
}

/** holds a scalable image */
class ScalableImage{

	/** @type {Uint8Array} */
	pixels = null;

	neighbours = null;

	width = 0;
	height = 0;

	maxLayer = 0;

	child=null;

	constructor(imagedata, scale = 1){

		this.pixels = new Uint8Array(imagedata.data.length);
		this.pixels.set(imagedata.data);

		this.scale = scale;

		this.width = imagedata.width;
		this.height = imagedata.height;

		// bootstrap neighbours
		this.neighbours = new Uint8ClampedArray(imagedata.data.length/4);
		for(let x = 0; x < this.width; x++){
			for(let y = 0; y < this.height; y++){
				//
				
				let a = this.get(x,y);
				if(a){
					this.n(x,y);
				}
					
			}
		}
	}

	rescale(ppp){
		let p = new Uint8ClampedArray(Math.ceil(this.width/ppp)*Math.ceil(this.height/ppp)*4);
		let img = new ScalableImage(new ImageData(p, Math.ceil(this.width/ppp), Math.ceil(this.height/ppp)), this.scale*ppp);
		for(let y = 0; y < Math.ceil(this.height/ppp); y++){
			pixels:
			for(let x = 0; x < Math.ceil(this.width/ppp); x++){
				let rgb = [0, 0, 0];
				let count = 0;
				for(let i = 0; i < ppp; i++){
					for(let j = 0; j < ppp; j++){
						let nrgb = this.get(x*ppp+i, y*ppp+j);
						if(nrgb){
							rgb[0]+= nrgb[0];
							rgb[1]+= nrgb[1];
							rgb[2]+= nrgb[2];
							count ++;
						}
					}	
				}
				if(count){
					img.set(x, y, [Math.round(rgb[0]/count), Math.round(rgb[1]/count), Math.round(rgb[2]/count)]);
				}
			}	
		}
		this.child = img;
		return img;
	}

	/**
	 * 
	 * Returns the TRUTH
	 * 
	 * @param {Number} x 
	 * @param {Number} y 
	 * 
	 * @returns {Uint8Array}
	 */
	get(x,y){
		if(x < 0 || x>= this.width || y< 0 || y>= this.height)
			return null;
		let index = 4*(x + y * this.width);
		if(this.pixels[index+3] < 255)
			return null;
		//return  [this.pixels[index+0],this.pixels[index+1],this.pixels[index+2]]
		return this.pixels.subarray(index, index+4);
	}

	getBlock(x,y){
		let vector = new Array((chunkDims[0]*2+1)*(chunkDims[1]*2+1)*3);
		for(let i = -chunkDims[0]; i <= chunkDims[0]; i++){
			for(let j = -chunkDims[1]; j <= chunkDims[1]; j++){
				let c = this.get(x+i,y+j);
				if(c){
					let index = Chunk.vIndex(i,j);
					vector[index + 0] = c[0];
					vector[index + 1] = c[1];
					vector[index + 2] = c[2];
				}
			}
		}
		return vector;
	}

	countDims(_x,_y){
		let index = (_x + _y * this.width);
		return this.neighbours[index];
	}

	/**
	 * 
	 * @param {Number} _x 
	 * @param {Number} _y 
	 * @param {*} rgb 
	 */
	set(_x,_y,rgb){
		let index = 4*(_x + _y * this.width);
		this.pixels.set(rgb, index);
		this.pixels[index+3] = 255;
		this.n(_x,_y);
	}

	n(x,y){
		for(let i = -chunkDims[0]; i <= chunkDims[0]; i++){
			if(x+i< 0 || x+i>= this.width)
				continue;
			for(let j = -chunkDims[1]; j <= chunkDims[1]; j++){
				if(y+j< 0 || y+j>= this.height)
					continue;
				let index = ((x+i) + (y+j) * this.width);
				
				this.neighbours[index] += 1;
			}
		}
	}

	getPixels(){		
		return new ImageData(new Uint8ClampedArray(this.pixels.buffer), this.width, this.height);
	}
}


class ImagePatch{
	chunkDims = [2,2];
	chunkSize = (2*chunkDims[0]+1)*(2*chunkDims[1]+1);

	width = 0;
	height = 0;

	grid = null;

	constructor(img){
		
		this.grid = [];

		

		let i = new ScalableImage(img);
		this.source = i;

		let factor = Math.floor(i.width * i.height / SCALEDOWN);
		
		this.image = (factor>1)?i.rescale(factor):i;

		console.log(`patching image ${this.image.width}x${this.image.height} (downscale ${factor})`)

		this.width = i.width;
		this.height = i.height;

	}

	patch(feedback){
		let startTime = Date.now();

		feedback(this.image.getPixels());
		// generate chunks

		let blocks = [];

		let holes = [];
		let hashes = {};

		let dupes = 0;

		// 
		for(let x = 0; x < this.image.width; x++){
			for(let y = 0; y < this.image.height; y++){
				// 
				if(this.image.countDims(x, y) == chunkSize){
					if(Math.random() <= SAMPLING_CHANCE ){						
						let vector = this.image.getBlock(x, y);
						
						// 
						let dupe = false;
						if(CHUNK_DEDUPE_DIST>0){
							let [dist, block] = blockDist(vector, blocks);
							dupe = dist > CHUNK_DEDUPE_DIST;
						}else{
							let hash = vector.reduce((sum,v)=>256n*sum+BigInt(v), 0n);
							dupe = hashes[hash];
							hashes[hash] = true;
						}

						// 
						if(dupe){
							blocks.push(...vector);
						}else{
							dupes++;
						}
					}
				}else{
					let rgba = this.image.get(x, y);
					if(!rgba || rgba[3]==0){
						// empty
						let hole = new Hole(this.image, x,y);
						holes.push(hole);
					}
				}
			}
		}

		// chunk to array
		let matchBlock = new Uint8ClampedArray(blocks);

		console.log(`${holes.length} holes`);
		console.log(`${matchBlock.length / (chunkSize*3)} chunks (${dupes} dupes)`);

		shuffle(holes);

		let interval = 3000;
		let start = Date.now();
		let nextLog = start + interval;
		let done = 0;
		let total = holes.length;
		
		holes.sort((a,b)=>b.count-a.count);
		let bcount = holes[0].count;

		while(holes.length>0){
			let dStart = done;
			let dMax = 0;
			for(let i = 0; i < holes.length; i++){
				let hcount = holes[i].count;
				dMax = Math.max(hcount, dMax);
				if(hcount >= bcount){
					let hole = holes[i];
					holes.splice(i,1);
					i--;
					bcount = hcount;

					hole.fastApply(matchBlock);

					done++;
				}

			}
			if(done == dStart){
				bcount = dMax;
			}
			if(Date.now() > nextLog){
				nextLog += interval;
				console.log(`${done}/${total} (${1000*done/(Date.now()-start)} per second)`);
				
				feedback(this.image.getPixels());
			}
		}

		feedback(this.image.getPixels());

		console.log(`completed in ${Date.now() - startTime}ms`);
	}
}

/**
 * Represents a chunk of the image that can be used as a truth.
 */
const Chunk = {
	vIndex: (i,j)=>{
		return ((i+chunkDims[0]) + (j+chunkDims[1])*(chunkDims[0]*2+1)) * 3;
	}
}

function colorDiff(c1,c2){
	if(c1 == null || c2 == null)
		return MAX_DIST;
	return (Math.abs(c1[0]-c2[0]) + Math.abs(c1[1]-c2[1]) + Math.abs(c1[2]-c2[2])) / (255*3);
}

function shuffle(a) {
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

let computed = 0;

let flipH = [];

function flipArray(){
	for(let i = -chunkDims[0]; i <= chunkDims[0]; i++){
		for(let j = -chunkDims[1]; j <= chunkDims[1]; j++){
			flipH[Chunk.vIndex(i, j)] = Chunk.vIndex(-i, j);
			flipH[Chunk.vIndex(i, j)+1] = Chunk.vIndex(-i, j)+1;
			flipH[Chunk.vIndex(i, j)+2] = Chunk.vIndex(-i, j)+2;
		}
	}
}
flipArray();

function blockDist(vector, blocks){
	let best = null;
	let dist = Infinity;

	let dims = chunkSize*3;
	let unit = 1/dims;

	chunks:
	for(let i = 0; i < blocks.length; i+= dims){
		let dl = 0;
		let dr = 0;
		for(let j = 0; j < dims; j++){
			if(vector[j] != null){
				dl += unit*(Math.abs(vector[j] - blocks[i+j])/255);
				dr += unit*(Math.abs(vector[j] - blocks[i+flipH[j]])/255);
				if(dl>dist && dr>dist){
					continue chunks;
				}
			}
		}
		let d = dl<dr?dl:dr;
		if(d < dist || (d == dist && Math.random() > 0.5)){
			best = i + Chunk.vIndex(0, 0);
			dist = d;
		}
	}

	return [dist, best];
}

class Hole{

	/**
	 * 
	 * @param {ScalableImage} image 
	 * @param {Number} x 
	 * @param {Number} y 
	 */
	constructor(image, x,y){
		this.image = image;
		this.x = x;
		this.y = y;
	}

	get count(){
		return this.image.countDims(this.x,this.y);
	}

	/**
	 * 
	 * @param {Uint8ClampedArray} blocks 
	 */
	fastApply(blocks){
		let vector = this.image.getBlock(this.x, this.y);
		let [dist, best] = blockDist(vector, blocks);
		this.image.set(this.x, this.y, blocks.subarray(best,best+3));
	}
}
