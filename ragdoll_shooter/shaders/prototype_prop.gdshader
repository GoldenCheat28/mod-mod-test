// Материал предметов: та же сетка, но в координатах объекта (едет вместе с ним).
shader_type spatial;

#include "res://shaders/grid.gdshaderinc"

uniform vec4 base_color : source_color = vec4(0.8, 0.45, 0.12, 1.0);
uniform float roughness = 0.7;
uniform float metallic = 0.0;

varying vec3 obj_pos;
varying vec3 obj_nrm;

void vertex() {
	obj_pos = VERTEX;
	obj_nrm = NORMAL;
}

void fragment() {
	ALBEDO = proto_grid(obj_pos, normalize(obj_nrm), base_color.rgb);
	ROUGHNESS = roughness;
	METALLIC = metallic;
}
