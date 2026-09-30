extends Node
## The player's body state, modelled like the bots': about 5 l of blood,
## bleeding wounds that depend on where the bullet went, clotting of small
## wounds, pain, a limp from leg wounds. Losing blood drains colour and sharpness
## from the view and brings on a heartbeat; around 40% loss the player passes
## out, around 55% they die. A shot through the brain kills at once.
## There is no health bar: everything shows through the view and the body.

const Sfx = preload("res://scripts/audio/sfx.gd")
const BLOOD_MAX := 5000.0

signal passed_out
signal came_to
signal died

var player
var blood := BLOOD_MAX
var bleed := 0.0          # ml/s
var pain := 0.0
var leg := 1.0            # 1 = fine, 0 = cannot use the legs
var alive := true
## Where he is hurt, for the body to show (player_body.gd) and the bandage
## to go on: {seg ("thigh", "shin", "upper_arm", "forearm", "torso", "head"),
## side ("r"/"l"), t (along the limb 0 = top / height on the trunk), ang
## (round the limb, 0 = front), rate (ml/s it adds), soak (ml in the clothes
## round it), bandaged, drip}.
var wounds: Array = []
var conscious := true
var _beat_t := 0.0
var _out_t := 0.0         # how long out cold while still bleeding
var _hit_frame := -1
var _hits_this_frame := 0


func loss() -> float:
	return 1.0 - blood / BLOOD_MAX


## Where the bullet went decides what it does. Pellets from one shotgun blast
## arrive in the same frame and each counts less.
func hurt(point: Vector3, _dir: Vector3, weapon: String, region := "") -> void:
	if not alive:
		return
	var f := Engine.get_physics_frames()
	if f != _hit_frame:
		_hit_frame = f
		_hits_this_frame = 0
	_hits_this_frame += 1
	var pellet := weapon == "shotgun" or weapon == "frag"
	var k := (0.5 if pellet else 1.0) / sqrt(float(_hits_this_frame))
	if region == "":
		var h: float = point.y - player.global_position.y
		region = "head" if h > 1.5 else ("chest" if h > 1.05 else ("belly" if h > 0.75 else "leg"))
	_wound(region, pellet, k)


## Hit on the player's ragdoll: the body part is known.
func hurt_part(part: String, weapon: String) -> void:
	if not alive:
		return
	_at_part = part
	var region := "leg"
	if part == "head":
		region = "head"
	elif part == "chest" or part.begins_with("upper_arm"):
		region = "chest"
	elif part == "abdomen" or part == "pelvis":
		region = "belly"
	var pel := weapon == "shotgun" or weapon == "frag"
	_wound(region, pel, 0.5 if pel else 1.0)
	_at_part = ""


## Hitting the ground at `speed` m/s (landing or as a ragdoll). Up to ~7.5
## (a 3 m drop) it only jars; then the legs give (sprains, fractures: limping
## and no jumping), from ~11 internal bleeding and passing out, ~15 is fatal.
func fall(speed: float) -> void:
	if not alive or speed < 7.5:
		return
	var k := speed - 7.5
	leg = maxf(leg - k * 0.22, 0.0)
	pain = minf(pain + k * 0.35, 2.0)
	Game.play_3d(Sfx.get_stream(&"flesh"), player.global_position, -4.0, 0.1, 2.0)
	if speed > 11.0:
		bleed += (speed - 11.0) * 9.0
		if randf() < (speed - 11.0) * 0.25:
			blood = minf(blood, BLOOD_MAX * 0.62)   # knocked out cold
	if speed > 15.0:
		_die()


## A bandage on (on wound `w`, or just generally): that wound all but stops
## bleeding, the pain eases; on a leg it is strapped up and takes weight
## better again.
func bandage(w := {}) -> void:
	if w.is_empty():
		bleed *= 0.25
	else:
		w["bandaged"] = true
		var r: float = w["rate"]
		bleed = maxf(bleed - r * 0.85, bleed * 0.25 if wounds.size() <= 1 else 0.0)
		w["rate"] = r * 0.15
		if w["seg"] in ["thigh", "shin"]:
			leg = minf(leg + 0.45, 1.0)
	pain = maxf(pain - 0.6, 0.0)


var _at_part := ""


func _wound(region: String, pellet: bool, k: float) -> void:
	var before := bleed
	_wound_effect(region, pellet, k)
	_place_wound(region, maxf(bleed - before, 0.0))


## Puts the wound somewhere on the body in the hit region.
func _place_wound(region: String, rate: float) -> void:
	if not alive and region == "head":
		return
	var w := {"rate": rate, "soak": 0.0, "bandaged": false, "drip": 0.0,
			"side": "r" if randf() < 0.5 else "l", "t": randf_range(0.2, 0.8), "ang": randf_range(-2.2, 2.2)}
	var part := _at_part
	if part != "":
		for seg in ["thigh", "shin", "upper_arm", "forearm"]:
			if part.begins_with(seg):
				w["seg"] = seg
				w["side"] = part.substr(part.length() - 1)
		if part.begins_with("hand"):
			w["seg"] = "forearm"
			w["t"] = 0.9
			w["side"] = part.substr(part.length() - 1)
		if part.begins_with("foot"):
			w["seg"] = "shin"
			w["t"] = 0.9
			w["side"] = part.substr(part.length() - 1)
	if not w.has("seg"):
		match region:
			"head":
				w["seg"] = "head"
			"chest":
				w["seg"] = "upper_arm" if randf() < 0.2 else "torso"
				w["t"] = randf_range(0.2, 0.4) if w["seg"] == "torso" else w["t"]
			"belly":
				w["seg"] = "torso"
				w["t"] = randf_range(-0.05, 0.14)
			_:
				w["seg"] = "thigh" if randf() < 0.6 else "shin"
	wounds.append(w)


## The worst wound not yet bandaged (a hurt leg with no wound counts too:
## it gets strapped up). Empty when there is nothing to see to.
func bandage_target() -> Dictionary:
	var best := {}
	for w in wounds:
		if w["bandaged"] or w["seg"] == "head":
			continue
		if best.is_empty() or float(w["rate"]) > float(best["rate"]):
			best = w
	if best.is_empty() and leg < 0.9:
		best = {"seg": "shin", "side": "r" if randf() < 0.5 else "l", "t": 0.45, "ang": 0.0, "rate": 0.0,
				"soak": 0.0, "bandaged": false, "drip": 0.0, "strap": true}
		wounds.append(best)
	return best


func _wound_effect(region: String, pellet: bool, k: float) -> void:
	if region == "head":
		# Head: through the brain is instant; a graze bleeds heavily.
		if randf() < (0.3 if pellet else 0.8):
			_die()
			return
		bleed += 30.0 * k
		pain += 1.0
	elif region == "chest":
		# Chest: lungs and big vessels.
		bleed += randf_range(12.0, 40.0) * k
		if randf() < 0.12 * k:
			bleed += 90.0          # heart or aorta
		pain += 0.8 * k
	elif region == "belly":
		bleed += randf_range(8.0, 16.0) * k
		pain += 0.7 * k
	else:
		bleed += randf_range(3.0, 8.0) * k
		if randf() < 0.1 * k:
			bleed += 35.0          # femoral artery
		leg = maxf(leg - 0.35 * k, 0.0)
		pain += 0.6 * k
	pain = minf(pain, 2.0)


func _physics_process(d: float) -> void: # @@PROF@@
	var __t := Time.get_ticks_usec()
	_physics_process_real(d)
	var __d := Time.get_ticks_usec() - __t
	Game.prof["vitals._physics_process"] = Game.prof.get("vitals._physics_process", 0) + __d
	Game.prof["max vitals._physics_process"] = maxi(Game.prof.get("max vitals._physics_process", 0), __d)


func _physics_process_real(delta: float) -> void:
	if not alive:
		return
	# A big wound: as the pressure falls the body goes into shock and it goes
	# quicker (not a minute and a half of slowly dimming).
	var shock_k := 1.0 + clampf((bleed - 10.0) / 20.0, 0.0, 1.0) * clampf((loss() - 0.1) / 0.15, 0.0, 1.0) * 1.2
	blood = maxf(blood - bleed * shock_k * delta, 0.0)
	# The clothes round each wound soak it up.
	for w in wounds:
		w["soak"] = minf(float(w["soak"]) + float(w["rate"]) * delta * 0.4, 400.0)
	# Small wounds clot; big ones do not.
	if bleed < 18.0:
		bleed = maxf(bleed - delta * 0.15, 0.0)
	if bleed <= 0.01:
		blood = minf(blood + delta * 0.5, BLOOD_MAX)
		leg = minf(leg + delta * 0.004, 1.0)
	pain = maxf(pain - delta * 0.04, 0.0)
	var l := loss()
	if l > 0.475:
		_die()
		return
	# Out cold and still bleeding on: a few seconds of it, then the end
	# (no long wait in the dark before the black).
	if not conscious and bleed > 2.0:
		_out_t += delta
		if _out_t > 4.0:
			_die()
			return
	else:
		_out_t = 0.0
	if conscious and l > 0.4:
		conscious = false
		passed_out.emit()
	elif not conscious and l < 0.36 and bleed < 0.5:
		conscious = true
		came_to.emit()
	# Heartbeat: louder and faster as blood runs out.
	if l > 0.15:
		_beat_t -= delta
		if _beat_t <= 0.0:
			var rate := lerpf(1.3, 2.6, clampf((l - 0.15) / 0.3, 0.0, 1.0))
			_beat_t = 1.0 / rate
			var p := AudioStreamPlayer.new()
			p.stream = Sfx.get_stream(&"heartbeat")
			p.volume_db = lerpf(-22.0, -6.0, clampf((l - 0.15) / 0.3, 0.0, 1.0))
			player.add_child(p)
			p.finished.connect(p.queue_free)
			p.play()


## Speed multiplier from wounds: legs, blood loss, pain.
func mobility() -> float:
	var l := loss()
	return clampf((0.35 + 0.65 * leg) * (1.0 - clampf((l - 0.2) / 0.25, 0.0, 0.6)) * (1.0 - 0.15 * minf(pain, 1.0)), 0.15, 1.0)


func _die() -> void:
	if not alive:
		return
	alive = false
	conscious = false
	died.emit()
