/*
Load glTF model as glb
Get the list of vertices
*/

import { WebIO } from '@gltf-transform/core';
import modelUrl from '../tree.glb?url';
//import modelUrl from '../Box.gltf?url';

export async function loadModel() {
	const io = new WebIO({credentials: 'include'});
	const doc = await io.read(modelUrl);
	window.doc = doc;
	// doc.getRoot().meshes[0].getChild().primitives[0].getChild().getAttribute('POSITION').getArray()
	// I don't think indices are used here?
	// doc.getRoot().meshes[0].getChild().primitives[0].getChild().indices.getChild().getArray()
	const positions = doc.getRoot().meshes[0].getChild().primitives[0].getChild().getAttribute('POSITION').getArray();
	const indices = doc.getRoot().meshes[0].getChild().primitives[0].getChild().indices.getChild().getArray();
	window.indices = indices;
	window.positions = positions;
	const finalPositions = [];

	for (let i = 0; i < indices.length; i++) {
		const index1 = indices[i] * 3 + 0;
		const index2 = indices[i] * 3 + 1;
		const index3 = indices[i] * 3 + 2;

		finalPositions.push(positions[index1]);
		finalPositions.push(positions[index2]);
		finalPositions.push(positions[index3]);
		// if (i > 6)
		// 	break;
	}
	return new Float32Array(finalPositions);
}