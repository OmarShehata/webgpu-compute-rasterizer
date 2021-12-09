import { WebIO } from '@gltf-transform/core';
import modelUrl from '../models/suzanne.glb?url';

export async function loadModel() {
	const io = new WebIO({credentials: 'include'});
	const doc = await io.read(modelUrl);

	const positions = doc.getRoot().meshes[0].getChild().primitives[0].getChild().getAttribute('POSITION').getArray();
	const indices = doc.getRoot().meshes[0].getChild().primitives[0].getChild().indices.getChild().getArray();
	const finalPositions = [];

	for (let i = 0; i < indices.length; i++) {
		const index1 = indices[i] * 3 + 0;
		const index2 = indices[i] * 3 + 1;
		const index3 = indices[i] * 3 + 2;

		finalPositions.push(positions[index1]);
		finalPositions.push(positions[index2]);
		finalPositions.push(positions[index3]);
	}
	return new Float32Array(finalPositions);
}