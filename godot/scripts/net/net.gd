extends Node
## Multiplayer: Steam lobbies to find each other (GodotSteam, addons/godotsteam)
## and SteamMultiplayerPeer for the P2P link - or ENet on the LAN (two
## windows on one PC: Steam cannot join a lobby with the same account).
## An autoload at /root/Net, so every copy of the game has the same RPC paths.
##
## The host owns the world: the people (bots) live and think only on the host,
## and it streams where every part of every body is to the others, who show
## them as puppets. Each player moves on their own machine and sends out how
## their body stands (the same numbers their own first-person body is drawn
## from: player_body.gd), or - lying as a ragdoll - where each part is. Shots
## go to everyone (sound, flash); a hit on a person is worked out by the host,
## a hit on another player is sent to that player.

signal lobby_changed
signal found_changed

const STEAM_APP := 480           # Spacewar (Valve's test app) until the game has its own
const STEAM_TAG := "blood_ragdoll"
const PORT := 24600
const MAX_PLAYERS := 6
const SEND_RATE := 30.0
const BOT_RATE := 15.0
const RemotePlayer = preload("res://scripts/net/remote_player.gd")

var steam: Object = null
var steam_ok := false
var use_steam := false
var my_steam := 0
var steam_lobby := 0
var active := false
var is_host := false
var in_game := false
var status := ""
var my_name := "Игрок"
var members := {}                # peer id -> {"name"}
var found: Array = []            # Steam lobbies: [{"id", "name", "players"}]
var puppets := {}                # peer id -> RemotePlayer
var _send_t := 0.0
var _bot_t := 0.0
var _creating := false
var _autostart := false
var _helpers := {}               # host: weapon kind -> hidden Weapon, to trace others' shots


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected)
	multiplayer.connection_failed.connect(func(): status = "Не удалось подключиться"; _drop())
	multiplayer.server_disconnected.connect(func(): status = "Хост отключился"; _drop())
	_steam_init()
	# Tests / two windows: --mp-host, --mp-join=<ip>, --mp-name=<n>, --mp-autostart
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--mp-name="):
			my_name = arg.get_slice("=", 1)
		elif arg == "--mp-host":
			host_lan.call_deferred()
		elif arg.begins_with("--mp-join="):
			join_lan.call_deferred(arg.get_slice("=", 1))
		elif arg == "--mp-autostart":
			_autostart = true


func _steam_init() -> void:
	if not Engine.has_singleton("Steam"):
		return
	steam = Engine.get_singleton("Steam")
	var r: Dictionary = steam.steamInitEx(STEAM_APP, true)
	if r.get("status", -1) != 0:
		print("Steam: not available (%s)" % r.get("verbal", r))
		steam = null
		return
	steam_ok = true
	my_steam = steam.getSteamID()
	my_name = steam.getPersonaName()
	steam.lobby_created.connect(_on_lobby_created)
	steam.lobby_joined.connect(_on_lobby_joined)
	steam.lobby_match_list.connect(_on_lobby_list)
	steam.join_requested.connect(func(lobby_id: int, _who: int): join_lobby(lobby_id))


# --- Lobbies ----------------------------------------------------------------------------

## Steam: make a lobby (others see it in their list) and open the server.
func host_lobby() -> void:
	if not steam_ok:
		status = "Steam не запущен - только LAN"
		lobby_changed.emit()
		return
	leave()
	use_steam = true
	_creating = true
	status = "Создаём лобби..."
	steam.createLobby(2, MAX_PLAYERS)
	lobby_changed.emit()


func _on_lobby_created(result: int, lobby_id: int) -> void:
	if not _creating:
		return
	_creating = false
	if result != 1:
		status = "Steam не создал лобби (%d)" % result
		lobby_changed.emit()
		return
	steam_lobby = lobby_id
	steam.setLobbyJoinable(lobby_id, true)
	steam.setLobbyData(lobby_id, "game", STEAM_TAG)
	steam.setLobbyData(lobby_id, "name", my_name)
	var sp: MultiplayerPeer = ClassDB.instantiate("SteamMultiplayerPeer")
	if sp.call("create_host", 0) != OK:
		status = "Не удалось открыть сервер"
		lobby_changed.emit()
		return
	_start_host(sp)


func refresh() -> void:
	if not steam_ok:
		status = "Steam не запущен"
		found_changed.emit()
		return
	steam.addRequestLobbyListStringFilter("game", STEAM_TAG, 0)
	steam.addRequestLobbyListDistanceFilter(3)
	steam.requestLobbyList()
	status = "Ищем лобби..."
	found_changed.emit()


func _on_lobby_list(lobbies: Array) -> void:
	found.clear()
	for id in lobbies:
		found.append({"id": id, "name": steam.getLobbyData(id, "name"), "players": steam.getNumLobbyMembers(id)})
	status = "Найдено лобби: %d" % found.size()
	found_changed.emit()


func join_lobby(lobby_id: int) -> void:
	leave()
	use_steam = true
	status = "Входим в лобби..."
	steam.joinLobby(lobby_id)
	lobby_changed.emit()


func _on_lobby_joined(lobby_id: int, _perm: int, _locked: bool, response: int) -> void:
	if response != 1:
		status = "Не удалось войти (%d)" % response
		lobby_changed.emit()
		return
	steam_lobby = lobby_id
	var owner: int = steam.getLobbyOwner(lobby_id)
	if owner == my_steam or active:
		return
	var sp: MultiplayerPeer = ClassDB.instantiate("SteamMultiplayerPeer")
	if sp.call("create_client", owner, 0) != OK:
		status = "Не удалось подключиться"
		lobby_changed.emit()
		return
	_start_client(sp)


## LAN (ENet): a server here / a client to `ip`.
func host_lan() -> void:
	leave()
	use_steam = false
	var peer := ENetMultiplayerPeer.new()
	if peer.create_server(PORT, MAX_PLAYERS) != OK:
		status = "Порт %d занят" % PORT
		lobby_changed.emit()
		return
	_start_host(peer)


func join_lan(ip: String) -> void:
	leave()
	use_steam = false
	var peer := ENetMultiplayerPeer.new()
	if peer.create_client(ip, PORT) != OK:
		status = "Не удалось подключиться"
		lobby_changed.emit()
		return
	_start_client(peer)


func _start_host(peer: MultiplayerPeer) -> void:
	multiplayer.multiplayer_peer = peer
	active = true
	is_host = true
	members = {1: {"name": my_name}}
	status = "Лобби создано. Ждём игроков"
	lobby_changed.emit()


func _start_client(peer: MultiplayerPeer) -> void:
	multiplayer.multiplayer_peer = peer
	active = true
	is_host = false
	status = "Подключение..."
	lobby_changed.emit()


func _on_connected() -> void:
	status = "В лобби. Ждём хоста"
	_hello.rpc_id(1, my_name)
	lobby_changed.emit()


func _on_peer_connected(_id: int) -> void:
	pass


func _on_peer_disconnected(id: int) -> void:
	members.erase(id)
	if puppets.has(id):
		if is_instance_valid(puppets[id]):
			puppets[id].queue_free()
		puppets.erase(id)
	if is_host:
		_lobby.rpc(members)
	lobby_changed.emit()


func leave() -> void:
	_creating = false
	if steam_lobby != 0 and steam:
		steam.leaveLobby(steam_lobby)
	steam_lobby = 0
	if active:
		multiplayer.multiplayer_peer.close()
		multiplayer.multiplayer_peer = OfflineMultiplayerPeer.new()
	_drop()


func _drop() -> void:
	active = false
	is_host = false
	in_game = false
	members = {}
	for id in puppets:
		if is_instance_valid(puppets[id]):
			puppets[id].queue_free()
	puppets = {}
	_bots_by_id = {}
	_next_bot_id = 1
	_props = {}
	_switches = []
	_graffiti = {}
	_g_buf = {}
	_map_pid = 1
	_dyn_pid = 100000
	lobby_changed.emit()


@rpc("any_peer", "call_remote", "reliable")
func _hello(name: String) -> void:
	if not is_host:
		return
	members[multiplayer.get_remote_sender_id()] = {"name": name}
	_lobby.rpc(members)
	lobby_changed.emit()
	if _autostart and members.size() >= 2:
		start_match.call_deferred()


@rpc("authority", "call_remote", "reliable")
func _lobby(list: Dictionary) -> void:
	members = list
	lobby_changed.emit()


## Host: everybody into the level.
func start_match() -> void:
	if not is_host:
		return
	if steam_lobby != 0:
		steam.setLobbyJoinable(steam_lobby, false)
	_start.rpc()


@rpc("authority", "call_local", "reliable")
func _start() -> void:
	_log("match starts")
	in_game = true
	get_tree().change_scene_to_file("res://scenes/main.tscn")


# --- In the level ----------------------------------------------------------------------

## Every person the host has gets a number for the net (the list order is not
## the same everywhere: a client's list holds only puppets, in arrival order).
var _next_bot_id := 1
var _bots_by_id := {}            # net id -> Humanoid (host: the real ones; client: the puppets)
var _world_t := 0.0
const GUN_KINDS := ["", "pistol", "shotgun", "akm", "revolver", "machete", "chainsaw"]


func bot_id(b: Node3D) -> int:
	if not b.has_meta("net_id"):
		b.set_meta("net_id", _next_bot_id)
		_bots_by_id[_next_bot_id] = b
		_next_bot_id += 1
	return int(b.get_meta("net_id"))


## A client's level is up: the host tells it who is about.
func client_loaded() -> void:
	for id in _props:
		if is_instance_valid(_props[id]):
			_hold(_props[id])
	_loaded.rpc_id(1)


@rpc("any_peer", "call_remote", "reliable")
func _loaded() -> void:
	if not is_host or Game.main == null:
		return
	var list: Array = []
	for b in Game.bots:
		if is_instance_valid(b):
			list.append([bot_id(b), b.bot_seed, b.position_ground(), atan2(-b.facing.x, -b.facing.z)])
	var who := multiplayer.get_remote_sender_id()
	_bots.rpc_id(who, list)
	var have: Array = []
	for id in _props:
		var n: RigidBody3D = _props[id]
		if not is_instance_valid(n):
			continue
		have.append(id)
		if id >= 100000:
			var is_gun := not n.has_meta("item")
			_drop_new.rpc_id(who, id, is_gun, n.kind if is_gun else String(n.get_meta("item")), n.get("count") if n.get("count") != null else 1, n.global_transform, Vector3.ZERO)
	_props_have.rpc_id(who, have)
	_world.rpc_id(who, _world_state())


@rpc("authority", "call_remote", "reliable")
func _bots(list: Array) -> void:
	_log("got %d people from the host" % list.size())
	for item in list:
		_spawn_puppet_bot(item[0], item[1], item[2], item[3])


## Host: someone new walked in (H, the mannequin): the others get him too.
## (Looked at a frame later: the trader is off the list by then - every copy
## of the game has its own trader in his place.)
func bot_spawned(b: Node3D) -> void:
	if active and is_host and in_game:
		_announce.call_deferred(b)


func _announce(b: Node3D) -> void:
	if is_instance_valid(b) and b in Game.bots:
		_bot_new.rpc([bot_id(b), b.bot_seed, b.position_ground(), atan2(-b.facing.x, -b.facing.z)])


@rpc("authority", "call_remote", "reliable")
func _bot_new(item: Array) -> void:
	# (a client still loading gets the whole list once it is up)
	if Game.main == null or Game.player == null:
		return
	_spawn_puppet_bot(item[0], item[1], item[2], item[3])


func _spawn_puppet_bot(id: int, seed_v: int, at: Vector3, yaw: float) -> void:
	if Game.main == null or (_bots_by_id.has(id) and is_instance_valid(_bots_by_id[id])):
		return
	var b: Node3D = Game.main.spawn_bot(at, yaw, seed_v)
	# A puppet here: no mind, no muscles; its parts go where the host says.
	if b.ai:
		b.ai.process_mode = Node.PROCESS_MODE_DISABLED
	b.process_mode = Node.PROCESS_MODE_DISABLED
	for p in b.parts:
		p.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		p.freeze = true
		p.process_mode = Node.PROCESS_MODE_ALWAYS
	b.set_meta("puppet", true)
	b.set_meta("net_id", id)
	_bots_by_id[id] = b


func _process(delta: float) -> void:
	if not active or not in_game or Game.main == null:
		return
	_probe(delta)
	_send_t -= delta
	if _send_t <= 0.0 and Game.player and is_instance_valid(Game.player):
		_send_t = 1.0 / SEND_RATE
		var st: PackedFloat32Array = Game.player.net_state()
		if not st.is_empty():
			_pstate.rpc(st)
	if is_host:
		_bot_t -= delta
		if _bot_t <= 0.0:
			_bot_t = 1.0 / BOT_RATE
			_bot_states.rpc(_pack_bots())
		_world_t -= delta
		if _world_t <= 0.0:
			_world_t = 2.0
			_world.rpc(_world_state())
	_props_tick(delta)
	_graffiti_tick(delta)
	# Puppets ease towards the last state they were sent.
	var k := minf(delta * 14.0, 1.0)
	for id in _bots_by_id:
		var b: Node3D = _bots_by_id[id]
		if not is_instance_valid(b) or not b.has_meta("puppet") or not b.has_meta("net_to"):
			continue
		var to: Array = b.get_meta("net_to")
		for i in mini(to.size(), b.parts.size()):
			var p: RigidBody3D = b.parts[i]
			p.global_transform = p.global_transform.interpolate_with(to[i], k)
		if b.has_meta("net_gun") and b.weapon and is_instance_valid(b.weapon):
			b.weapon.global_transform = b.weapon.global_transform.interpolate_with(b.get_meta("net_gun"), k)


## Per person: id, flags (alive, conscious, fallen), the gun he holds (kind
## and where), and where each part of him is.
func _pack_bots() -> PackedFloat32Array:
	var out := PackedFloat32Array()
	var list: Array = []
	for b in Game.bots:
		if is_instance_valid(b):
			list.append(b)
	out.append(float(list.size()))
	for b in list:
		out.append(float(bot_id(b)))
		out.append(float(int(b.alive) | (int(b.conscious) << 1) | (int(b.fallen) << 2) | (int(b.cuffed) << 3)))
		var gk: int = GUN_KINDS.find(b.weapon_kind) if (b.weapon and is_instance_valid(b.weapon)) else 0
		gk = maxi(gk, 0)
		out.append(float(gk))
		if gk > 0:
			var gx: Transform3D = b.weapon.global_transform
			var gq := gx.basis.get_rotation_quaternion()
			out.append_array([gx.origin.x, gx.origin.y, gx.origin.z, gq.x, gq.y, gq.z, gq.w])
		out.append(float(b.parts.size()))
		for p in b.parts:
			var xf: Transform3D = p.global_transform
			var q := xf.basis.get_rotation_quaternion()
			out.append_array([xf.origin.x, xf.origin.y, xf.origin.z, q.x, q.y, q.z, q.w])
	return out


static func _xf(d: PackedFloat32Array, k: int) -> Transform3D:
	return Transform3D(Basis(Quaternion(d[k + 3], d[k + 4], d[k + 5], d[k + 6]).normalized()), Vector3(d[k], d[k + 1], d[k + 2]))


@rpc("authority", "call_remote", "unreliable_ordered")
func _bot_states(data: PackedFloat32Array) -> void:
	if Game.main == null or data.is_empty():
		return
	var n := int(data[0])
	var k := 1
	for bi in n:
		if k + 4 > data.size():
			return
		var id := int(data[k])
		var flags := int(data[k + 1])
		var gk := int(data[k + 2])
		k += 3
		var gun_xf := Transform3D()
		if gk > 0:
			gun_xf = _xf(data, k)
			k += 7
		var parts_n := int(data[k])
		k += 1
		var to: Array = []
		for pi in parts_n:
			to.append(_xf(data, k))
			k += 7
		var b: Node3D = _bots_by_id.get(id)
		if b == null or not is_instance_valid(b) or not b.has_meta("puppet"):
			continue
		b.set_meta("net_to", to)
		# The host says whether he lives (a shot here does not decide it).
		b.alive = bool(flags & 1)
		b.conscious = bool(flags & 2)
		b.fallen = bool(flags & 4)
		if b.cuffed != bool(flags & 8):
			b.set_cuffed(bool(flags & 8))
		_puppet_gun(b, GUN_KINDS[clampi(gk, 0, GUN_KINDS.size() - 1)], gun_xf)


## The gun in a puppet's hands: made or taken away as the host's changes.
func _puppet_gun(b: Node3D, kind: String, xf: Transform3D) -> void:
	var have: String = b.get_meta("net_gun_kind", "")
	if kind != have:
		if b.weapon and is_instance_valid(b.weapon):
			b.weapon.queue_free()
		b.weapon = null
		b.weapon_kind = ""
		b.set_meta("net_gun_kind", kind)
		if kind != "":
			var Models = load("res://scripts/weapons/weapon_models.gd")
			var m: Node3D
			match kind:
				"shotgun":
					m = Models.shotgun()
				"akm":
					m = Models.akm()
				"machete":
					m = load("res://scripts/weapons/machete.gd").new()
					m.freeze = true
				"chainsaw":
					m = load("res://scripts/weapons/chainsaw.gd").new()
				_:
					m = Models.pistol()
			m.top_level = true
			b.add_child(m)
			m.global_transform = xf
			b.weapon = m
			b.weapon_kind = kind
	if kind != "":
		b.set_meta("net_gun", xf)


# --- The world: time of day and weather come from the host -------------------------------

func _world_state() -> Array:
	var dn = Game.main.day_night if Game.main else null
	var w = Game.main.weather if Game.main else null
	return [dn.hour if dn else 13.0, w.storm if w else 0.0, w._target if w else 0.0, w.wetness if w else 0.0]


@rpc("authority", "call_remote", "reliable")
func _world(st: Array) -> void:
	if Game.main == null:
		return
	var dn = Game.main.day_night
	var w = Game.main.weather
	if dn:
		dn.hour = float(st[0])
	if w:
		w.storm = float(st[1])
		w._target = float(st[2])
		w._next_change = 9999.0          # (the host decides where it goes)
		w.wetness = float(st[3])


# --- People talking and shooting (host) -------------------------------------------------

## A person said a line: the others hear it from his puppet.
func bot_said(b: Node3D, line: String, pitch: float) -> void:
	if active and is_host and in_game and b.has_meta("net_id"):
		_said.rpc(int(b.get_meta("net_id")), line, pitch)


@rpc("authority", "call_remote", "unreliable")
func _said(id: int, line: String, pitch: float) -> void:
	var b: Node3D = _bots_by_id.get(id)
	if b == null or not is_instance_valid(b):
		return
	var s: AudioStream = load("res://scripts/bots/chatter.gd").stream(line)
	if s == null:
		return
	var v := AudioStreamPlayer3D.new()
	v.stream = s
	v.bus = &"World"
	v.unit_size = 3.0
	v.max_distance = 35.0
	v.volume_db = -3.0
	v.pitch_scale = pitch
	b.head.add_child(v)
	v.finished.connect(v.queue_free)
	v.play()


## A person fired: the others hear it and see where it went.
func bot_shot(muzzle: Vector3, dirs: Array, kind: String) -> void:
	if active and is_host and in_game:
		_bshot.rpc(muzzle, dirs, kind)


@rpc("authority", "call_remote", "unreliable")
func _bshot(muzzle: Vector3, dirs: Array, kind: String) -> void:
	if Game.main == null:
		return
	var shot: StringName = {"shotgun": &"shotgun_shot", "akm": &"akm_shot"}.get(kind, &"pistol_shot")
	Game.play_3d(preload("res://scripts/audio/sfx.gd").get_stream(shot), muzzle, 0.0 if kind == "akm" else 2.0, 0.06, 18.0)
	Game.fx.muzzle_smoke(muzzle, dirs[0] if not dirs.is_empty() else Vector3.FORWARD, 1.0 if kind == "shotgun" else 0.55)
	Game.gunshot.emit(muzzle, 1.6 if kind == "shotgun" else (1.9 if kind == "akm" else 1.0))
	var w: Node3D = _helper(kind)
	var none: Array[RID] = []
	for d in dirs:
		w.shoot_along(Game.main.get_world_3d().direct_space_state, muzzle, d, none)


@rpc("any_peer", "call_remote", "unreliable_ordered")
func _pstate(st: PackedFloat32Array) -> void:
	if Game.main == null:
		return
	var id := multiplayer.get_remote_sender_id()
	var pup: Node3D = puppets.get(id)
	if pup == null or not is_instance_valid(pup):
		pup = RemotePlayer.new()
		pup.peer = id
		pup.display_name = String(members.get(id, {}).get("name", "Игрок"))
		Game.main.add_child(pup)
		puppets[id] = pup
		_log("player %d appeared" % id)
	pup.apply(st)


# --- Shots and hits -------------------------------------------------------------------------

## The local player fired: the others hear and see it; on the host the
## bullets are worked out against the people.
func local_shot(origin: Vector3, dir: Vector3, kind: String) -> void:
	if active and in_game:
		_shot.rpc(origin, dir, kind)


@rpc("any_peer", "call_remote", "unreliable")
func _shot(origin: Vector3, dir: Vector3, kind: String) -> void:
	if Game.main == null:
		return
	var id := multiplayer.get_remote_sender_id()
	var pup: Node3D = puppets.get(id)
	if pup and is_instance_valid(pup):
		pup.fired(kind)
	var shot: StringName = {"pistol": &"pistol_shot", "revolver": &"rev_shot", "akm": &"akm_shot", "rifle": &"rifle_shot",
			"crossbow": &"mop_swish", "nailgun": &"casing", "flaregun": &"shell_drop"}.get(kind, &"shotgun_shot")
	Game.play_3d(preload("res://scripts/audio/sfx.gd").get_stream(shot), origin, 2.0, 0.05, 18.0)
	Game.gunshot.emit(origin, {"crossbow": 0.1, "nailgun": 0.3, "flaregun": 0.7, "sawnoff": 2.2}.get(kind, 1.0))
	var w: Node3D = _helper(kind)
	w.net_shooter = pup if (pup and is_instance_valid(pup)) else null
	var ex: Array[RID] = []
	if pup and is_instance_valid(pup):
		ex.append(pup.hitbox.get_rid())
		if pup._h and is_instance_valid(pup._h):
			for part in pup._h.parts:
				ex.append(part.get_rid())
	var n_pel: int = {"shotgun": 9, "sawnoff": 12}.get(kind, 1)
	for i in n_pel:
		var d := dir
		if n_pel > 1:
			d = (dir + Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * (0.045 if kind == "shotgun" else 0.1)).normalized()
		w.shoot_along(Game.main.get_world_3d().direct_space_state, origin, d, ex)
	if OS.has_environment("NET_DEBUG"):
		var q := PhysicsRayQueryParameters3D.create(origin, origin + dir * 200.0, Game.LAYER_WORLD | Game.LAYER_PROPS | Game.LAYER_BOTS)
		q.exclude = ex
		var hit := Game.main.get_world_3d().direct_space_state.intersect_ray(q)
		_log("shot from %d at %s dir %s -> %s" % [id, origin.snapped(Vector3.ONE * 0.1), dir.snapped(Vector3.ONE * 0.01),
				(str(hit.collider.name) + " " + str(hit.position.snapped(Vector3.ONE * 0.1))) if not hit.is_empty() else "nothing"])
	w.net_shooter = null


func _log(t: String) -> void:
	if OS.has_environment("NET_DEBUG"):
		print("NET[%s] %s" % ["host" if is_host else "client", t])


func _helper(kind: String) -> Node3D:
	if not _helpers.has(kind) or not is_instance_valid(_helpers[kind]):
		var w = load("res://scripts/weapons/weapon.gd").new()
		w.visible = false
		w.net_echo = true
		Game.main.add_child(w)
		w.setup(kind)
		_helpers[kind] = w
	return _helpers[kind]


## A bullet hit another player's body (their puppet here): it is theirs to feel.
func hit_remote(peer: int, point: Vector3, dir: Vector3, kind: String, part: Node = null) -> void:
	if active:
		_hit.rpc_id(peer, point, dir, kind)
		# Everyone (here too) sees the wound on that player's body.
		var pup = puppets.get(peer)
		if pup and is_instance_valid(pup) and pup._h and part is RigidBody3D and pup._h.parts.has(part):
			var i: int = pup._h.parts.find(part)
			var lp := (part as RigidBody3D).global_transform.affine_inverse() * point
			var ld := (part as RigidBody3D).global_basis.inverse() * dir
			pup.wound(i, lp, ld, kind)
			_pwound.rpc(peer, i, lp, ld, kind)


## Someone's shot went into player `peer`: the wound, on their body as it is
## seen here (they themselves feel it through _hit).
@rpc("any_peer", "call_remote", "reliable")
func _pwound(peer: int, part_i: int, lp: Vector3, ld: Vector3, kind: String) -> void:
	var pup = puppets.get(peer)
	if pup and is_instance_valid(pup):
		pup.wound(part_i, lp, ld, kind)


## Explosions: whoever's it is, it goes off in every copy of the game (each
## works out what it does to its own player; the host's what it does to the
## people).
var _booming := false


func local_boom(pos: Vector3, power: float, smoke: float, sound: StringName) -> void:
	if active and in_game and not _booming:
		_boom.rpc(pos, power, smoke, String(sound))


@rpc("any_peer", "call_remote", "reliable")
func _boom(pos: Vector3, power: float, smoke: float, sound: String) -> void:
	if Game.main == null:
		return
	_booming = true
	var none: Array[RID] = []
	load("res://scripts/weapons/explosion.gd").explode(get_tree(), pos, power, smoke, none, StringName(sound))
	_booming = false


@rpc("any_peer", "call_remote", "reliable")
func _hit(point: Vector3, dir: Vector3, kind: String) -> void:
	if Game.player and is_instance_valid(Game.player):
		Game.player.hurt(point, dir, kind)


# --- Test probe (NET_PROBE=<dir>): prints what each side sees, takes pictures ----------------

var _probe_t := 0.0
var _probe_done := {}


func _probe(delta: float) -> void:
	var dir := OS.get_environment("NET_PROBE")
	if dir == "" or Game.main == null or Game.player == null or not is_instance_valid(Game.player):
		return
	_probe_t += delta
	var who := "host" if is_host else "client"
	var p = Game.player
	if int(_probe_t) != int(_probe_t - delta) and int(_probe_t) % 3 == 0:
		var pups := []
		for id in puppets:
			if is_instance_valid(puppets[id]):
				pups.append([id, puppets[id].hitbox.global_position.snapped(Vector3.ONE * 0.1)])
		var alive := 0
		var puppet_bots := 0
		for b in Game.bots:
			if is_instance_valid(b):
				alive += int(b.alive)
				puppet_bots += int(b.has_meta("puppet"))
		var bpos := []
		for b in Game.bots:
			if is_instance_valid(b):
				bpos.append([b.get_meta("net_id", -1), b.chest.global_position.snapped(Vector3.ONE * 0.1)])
		print("PROBE[%s] t=%d bots at %s" % [who, int(_probe_t), bpos])
		print("PROBE[%s] t=%d me=%s bots=%d alive=%d puppetbots=%d players=%s hour=%.2f storm=%.2f fps=%d" % [who, int(_probe_t),
				p.global_position.snapped(Vector3.ONE * 0.1), Game.bots.size(), alive, puppet_bots, pups,
				Game.main.day_night.hour if Game.main.day_night else -1.0, Game.main.weather.storm if Game.main.weather else -1.0,
				Engine.get_frames_per_second()])
	# The client walks towards the host's start and shoots the nearest person.
	if not is_host and _probe_t > 12.0 and _probe_t < 20.0:
		p.yaw = 0.0
		Input.action_press("move_forward")
	elif not is_host and _probe_t >= 20.0 and not _probe_done.has("stop"):
		_probe_done["stop"] = true
		Input.action_release("move_forward")
	if not is_host and _probe_t > 22.0 and not _probe_done.has("shoot"):
		_probe_done["shoot"] = true
		var best: Node3D = null
		for b in Game.bots:
			if is_instance_valid(b) and b.alive and (best == null or b.chest.global_position.distance_to(p.global_position) < best.chest.global_position.distance_to(p.global_position)):
				best = b
		if best:
			var to: Vector3 = best.chest.global_position - p.cam.global_position
			print("PROBE[client] shooting bot at %s dist %.1f" % [best.chest.global_position.snapped(Vector3.ONE * 0.1), to.length()])
			p._switch_to("pistol")
			p.set_meta("probe_aim", best)
	if not is_host and p.has_meta("probe_aim") and _probe_t > 23.5 and _probe_t < 26.0:
		var tgt: Node3D = p.get_meta("probe_aim")
		if is_instance_valid(tgt):
			var to: Vector3 = tgt.chest.global_position - p.cam.global_position
			p.yaw = atan2(-to.x, -to.z)
			p.pitch = atan2(to.y, Vector2(to.x, to.z).length())
			if int(_probe_t * 3) != int((_probe_t - delta) * 3) and p.current:
				var ex: Array[RID] = [p.get_rid()]
				p.current.try_fire(p.cam, ex)
	# Look at the other player for the pictures.
	if (_probe_t > 13.0 and _probe_t < 15.5) or (_probe_t > 28.5 and _probe_t < 30.5 and not is_host):
		for id in puppets:
			var pup = puppets[id]
			if is_instance_valid(pup):
				var to: Vector3 = pup.eye_position() - p.cam.global_position
				p.yaw = atan2(-to.x, -to.z)
				p.pitch = atan2(to.y, Vector2(to.x, to.z).length())
	# The client sets off a grenade by the nearest man: the host must feel it.
	if not is_host and _probe_t > 27.0 and not _probe_done.has("boom"):
		_probe_done["boom"] = true
		var tgt: Node3D = p.get_meta("probe_aim") if p.has_meta("probe_aim") else null
		if tgt and is_instance_valid(tgt):
			print("PROBE[client] boom by bot %d at %s" % [tgt.get_meta("net_id", -1), tgt.position_ground().snapped(Vector3.ONE * 0.1)])
			var none: Array[RID] = []
			load("res://scripts/weapons/explosion.gd").explode(get_tree(), tgt.position_ground() + Vector3(1.5, 0.3, 0), 1.0, 1.0, none)
	if not is_host and _probe_t > 25.0 and not _probe_done.has("drop"):
		_probe_done["drop"] = true
		print("PROBE[client] drops the pistol; has=", p.inventory.has("pistol"))
		p._drop_held()
	if _probe_t > 29.5 and not _probe_done.has("guns"):
		_probe_done["guns"] = true
		var guns := []
		for g in Game.pickups:
			if is_instance_valid(g) and g.get("kind") == "pistol":
				guns.append([g.get_meta("net_pid", -1), g.global_position.snapped(Vector3.ONE * 0.1)])
		print("PROBE[%s] pistols lying: %s" % [who, guns])
	if is_host and _probe_t > 29.0 and not _probe_done.has("after_boom"):
		_probe_done["after_boom"] = true
		var st := []
		for b in Game.bots:
			st.append([b.get_meta("net_id", -1), b.alive, b.conscious, snappedf(b.blood, 1.0)])
		print("PROBE[host] after boom: ", st)
	for mark in [15, 30]:
		if _probe_t > mark and not _probe_done.has("shot%d" % mark):
			_probe_done["shot%d" % mark] = true
			get_viewport().get_texture().get_image().save_png("%s/%s_%d.png" % [dir, who, mark])
	if _probe_t > 34.0 and not _probe_done.has("quit"):
		_probe_done["quit"] = true
		var alive := []
		for b in Game.bots:
			if is_instance_valid(b):
				alive.append(b.alive)
		print("PROBE[%s] end alive=%s" % [who, alive])
		get_tree().quit()


# --- Things: doors, guns and odd things lying about ---------------------------------------
## The host's copy is the real one. Each has a number: those the level is
## built with get them in build order (the same in every copy of the game),
## the ones dropped later are numbered by the host and made in the others.
## A client's copies are held still and moved to where the host's are; when
## the client pushes or drags one, the push goes to the host.

var _props := {}                 # id -> RigidBody3D
var _map_pid := 1
var _dyn_pid := 100000
var _forced_pid := -1            # the id for the thing being made from the host's word
var _props_t := 0.0
var _props_full_t := 0.0


## Called by every door / gun / item as it comes into the world.
func register_prop(n: RigidBody3D) -> void:
	var id: int
	if _forced_pid >= 0:
		id = _forced_pid
		_forced_pid = -1
	elif Game.player == null or not is_instance_valid(Game.player):
		id = _map_pid                     # part of the level being built
		_map_pid += 1
	else:
		id = _dyn_pid
		_dyn_pid += 1
	n.set_meta("net_pid", id)
	_props[id] = n
	if active and in_game and not is_host:
		_hold(n)


func unregister_prop(n: Node) -> void:
	if n.has_meta("net_pid") and _props.get(int(n.get_meta("net_pid"))) == n:
		_props.erase(int(n.get_meta("net_pid")))


## A client's copy: not its own physics; it goes where the host says.
func _hold(n: RigidBody3D) -> void:
	n.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
	n.freeze = true
	n.set_meta("net_held", true)


func _props_tick(delta: float) -> void:
	if is_host:
		_props_t -= delta
		_props_full_t -= delta
		if _props_t <= 0.0:
			_props_t = 0.1
			var full := _props_full_t <= 0.0
			if full:
				_props_full_t = 2.0
			var out := PackedFloat32Array()
			for id in _props:
				var n: RigidBody3D = _props[id]
				if not is_instance_valid(n) or not n.is_inside_tree():
					continue
				if not full and (n.sleeping or (n.linear_velocity.length_squared() < 0.0004 and n.angular_velocity.length_squared() < 0.0004)):
					continue
				var xf := n.global_transform
				var q := xf.basis.get_rotation_quaternion()
				out.append_array([float(id), xf.origin.x, xf.origin.y, xf.origin.z, q.x, q.y, q.z, q.w])
			if not out.is_empty():
				_prop_states.rpc(out)
		return
	var k := minf(delta * 12.0, 1.0)
	for id in _props:
		var n: RigidBody3D = _props[id]
		if is_instance_valid(n) and n.has_meta("net_to"):
			n.global_transform = n.global_transform.interpolate_with(n.get_meta("net_to"), k)


@rpc("authority", "call_remote", "unreliable_ordered")
func _prop_states(d: PackedFloat32Array) -> void:
	var i := 0
	while i + 8 <= d.size():
		var n: RigidBody3D = _props.get(int(d[i]))
		if n and is_instance_valid(n):
			n.set_meta("net_to", _xf(d, i + 1))
		i += 8


## A push or a drag on a thing (or on one of the people) that is the host's:
## sent there. Returns false when it is ours to push here.
func push(rb: RigidBody3D, impulse: Vector3, at: Vector3) -> bool:
	if not active or not in_game or is_host or rb == null:
		return false
	if rb.has_meta("net_pid"):
		_prop_push.rpc_id(1, int(rb.get_meta("net_pid")), impulse, at)
		return true
	if rb.has_meta("humanoid"):
		var h = rb.get_meta("humanoid")
		if h.has_meta("puppet") and h.has_meta("net_id"):
			_bot_push.rpc_id(1, int(h.get_meta("net_id")), h.parts.find(rb), impulse, at)
			return true
	return false


@rpc("any_peer", "call_remote", "unreliable")
func _prop_push(id: int, impulse: Vector3, at: Vector3) -> void:
	var n: RigidBody3D = _props.get(id)
	if is_host and n and is_instance_valid(n) and impulse.length() < 200.0:
		n.sleeping = false
		n.apply_impulse(impulse, at - n.global_position)


@rpc("any_peer", "call_remote", "unreliable")
func _bot_push(id: int, part: int, impulse: Vector3, at: Vector3) -> void:
	var b = _bots_by_id.get(id)
	if not is_host or b == null or not is_instance_valid(b) or part < 0 or part >= b.parts.size() or impulse.length() > 200.0:
		return
	b.wake()
	var rb: RigidBody3D = b.parts[part]
	rb.apply_impulse(impulse, at - rb.global_position)


## Something dropped into the world (a gun, an item). Offline and on the
## host it is made here (and on the host, told to the others); a client
## asks the host, who makes it for everyone.
func spawn_drop(parent: Node, is_gun: bool, what: String, count: int, xf: Transform3D, vel: Vector3) -> void:
	if active and in_game and not is_host:
		_drop_req.rpc_id(1, is_gun, what, count, xf, vel)
		return
	var n: RigidBody3D = _make_drop(parent, is_gun, what, count, xf, vel)
	if active and in_game and is_host and n:
		_drop_new.rpc(int(n.get_meta("net_pid")), is_gun, what, count, xf, vel)


func _make_drop(parent: Node, is_gun: bool, what: String, count: int, xf: Transform3D, vel: Vector3) -> RigidBody3D:
	if is_gun:
		return load("res://scripts/weapons/pickup.gd").spawn(parent, what, xf, vel)
	return load("res://scripts/game/item_drop.gd").spawn(parent, what, count, xf, vel)


@rpc("any_peer", "call_remote", "reliable")
func _drop_req(is_gun: bool, what: String, count: int, xf: Transform3D, vel: Vector3) -> void:
	if is_host and Game.main:
		spawn_drop(Game.main, is_gun, what, count, xf, vel)


@rpc("authority", "call_remote", "reliable")
func _drop_new(id: int, is_gun: bool, what: String, count: int, xf: Transform3D, vel: Vector3) -> void:
	if Game.main == null or _props.has(id):
		return
	_forced_pid = id
	_make_drop(Game.main, is_gun, what, count, xf, vel)
	_forced_pid = -1


## Taking a thing off the ground: yours at once offline / on the host; a
## client asks and gets it if nobody took it first (`done` is called with
## the thing just before it goes).
var _asks := {}                  # id -> Callable waiting for the host's yes


func take(n: RigidBody3D, done: Callable) -> void:
	if not active or not in_game or not n.has_meta("net_pid"):
		done.call(n)
		return
	var id := int(n.get_meta("net_pid"))
	if is_host:
		done.call(n)
		_taken.rpc(id)
		return
	_asks[id] = done
	_take_req.rpc_id(1, id)


@rpc("any_peer", "call_remote", "reliable")
func _take_req(id: int) -> void:
	if not is_host:
		return
	var who := multiplayer.get_remote_sender_id()
	var n: RigidBody3D = _props.get(id)
	if n == null or not is_instance_valid(n) or n.is_queued_for_deletion():
		_take_no.rpc_id(who, id)
		return
	_take_yes.rpc_id(who, id)
	_props.erase(id)
	if n.has_method("take"):
		n.take()
	else:
		n.queue_free()
	_taken.rpc(id)


@rpc("authority", "call_remote", "reliable")
func _take_yes(id: int) -> void:
	var n: RigidBody3D = _props.get(id)
	var cb: Callable = _asks.get(id, Callable())
	_asks.erase(id)
	if n and is_instance_valid(n) and cb.is_valid():
		cb.call(n)


@rpc("authority", "call_remote", "reliable")
func _take_no(id: int) -> void:
	_asks.erase(id)


## Gone from the world (taken by someone): gone here too.
func prop_taken(n: Node) -> void:
	if active and in_game and is_host and n.has_meta("net_pid"):
		_taken.rpc(int(n.get_meta("net_pid")))


@rpc("authority", "call_remote", "reliable")
func _taken(id: int) -> void:
	var n: RigidBody3D = _props.get(id)
	_props.erase(id)
	if n and is_instance_valid(n) and not n.is_queued_for_deletion():
		n.queue_free()


## (on joining) what of the level's things is still there on the host
@rpc("authority", "call_remote", "reliable")
func _props_have(ids: Array) -> void:
	var keep := {}
	for id in ids:
		keep[int(id)] = true
	for id in _props.keys():
		if id < 100000 and not keep.has(id):
			var n: RigidBody3D = _props[id]
			_props.erase(id)
			if is_instance_valid(n):
				n.queue_free()


# --- A client doing something to one of the people ------------------------------------------
## The people are the host's: what a client does to one (cuffs him, sprays
## him, cuts him, shows him a finger, talks to him...) is done there, to the
## real one. Only these can be asked for.
const BOT_CALLS := ["set_cuffed", "net_set", "net_hit", "net_slice", "net_ai"]


## Returns true when it went to the host (a client, a puppet); false: do it here.
func bot_call(b: Node3D, method: String, args: Array = []) -> bool:
	if not active or not in_game or is_host or b == null or not b.has_meta("puppet"):
		return false
	_bot_call.rpc_id(1, int(b.get_meta("net_id")), method, args)
	return true


@rpc("any_peer", "call_remote", "reliable")
func _bot_call(id: int, method: String, args: Array) -> void:
	var b = _bots_by_id.get(id)
	if not is_host or b == null or not is_instance_valid(b) or not method in BOT_CALLS:
		return
	var who: Node3D = puppets.get(multiplayer.get_remote_sender_id())
	b.set_meta("net_caller", who)
	b.callv(method, args)
	b.remove_meta("net_caller")


# --- Paint on the walls -------------------------------------------------------------------------

var _graffiti := {}              # id -> Graffiti
var _g_count := 0
var _g_buf := {}                 # id -> PackedFloat32Array of puffs not yet sent
var _g_t := 0.0


func graffiti_made(g: Node, point: Vector3, normal: Vector3, extent: Vector2) -> void:
	if not active or not in_game or not is_instance_valid(g):
		return
	_g_count += 1
	var id := multiplayer.get_unique_id() * 100000 + _g_count
	g.set_meta("net_gid", id)
	_graffiti[id] = g
	_g_new.rpc(id, point, normal, extent)


@rpc("any_peer", "call_remote", "reliable")
func _g_new(id: int, point: Vector3, normal: Vector3, extent: Vector2) -> void:
	if Game.main == null or _graffiti.has(id):
		return
	var G = load("res://scripts/world/graffiti.gd")
	var g = G.new()
	Game.main.add_child(g)
	G.from_net = true
	g.setup(point, normal, extent)
	G.from_net = false
	g.set_meta("net_gid", id)
	_graffiti[id] = g


func graffiti_spray(g: Node, xy: Vector2, c: Color, radius: float, strength: float) -> void:
	if not active or not in_game or not g.has_meta("net_gid"):
		return
	var id := int(g.get_meta("net_gid"))
	var buf: PackedFloat32Array = _g_buf.get(id, PackedFloat32Array())
	buf.append_array([xy.x, xy.y, c.r, c.g, c.b, radius, strength])
	_g_buf[id] = buf


func _graffiti_tick(delta: float) -> void:
	_g_t -= delta
	if _g_t > 0.0:
		return
	_g_t = 0.1
	for id in _g_buf:
		_g_spray.rpc(id, _g_buf[id])
	_g_buf.clear()
	_scrub_tick()


@rpc("any_peer", "call_remote", "reliable")
func _g_spray(id: int, d: PackedFloat32Array) -> void:
	var g = _graffiti.get(id)
	if g == null or not is_instance_valid(g):
		return
	var G = load("res://scripts/world/graffiti.gd")
	G.from_net = true
	var i := 0
	while i + 7 <= d.size():
		g.spray(Vector2(d[i], d[i + 1]), Color(d[i + 2], d[i + 3], d[i + 4]), d[i + 5], d[i + 6])
		i += 7
	G.from_net = false


# --- Light switches ---------------------------------------------------------------------------

var _switches: Array = []


func register_switch(s: Node) -> void:
	_switches.append(s)


func flip_switch(s: Node, on: bool) -> void:
	if active and in_game:
		_switch.rpc(_switches.find(s), on)
	else:
		s.set_on(on)


@rpc("any_peer", "call_local", "reliable")
func _switch(i: int, on: bool) -> void:
	if i >= 0 and i < _switches.size() and is_instance_valid(_switches[i]):
		_switches[i].set_on(on)


## A new level is being built (main.gd): its numbering starts again.
func new_level() -> void:
	_switches = []
	_stain_n = 0
	_scrub_buf = {}
	_props = {}
	_map_pid = 1
	_dyn_pid = 100000
	_graffiti = {}
	_g_buf = {}
	_bots_by_id = {}
	_next_bot_id = 1
	for id in puppets:
		if is_instance_valid(puppets[id]):
			puppets[id].queue_free()
	puppets = {}


# --- Cleaning ------------------------------------------------------------------------------------------

var _stain_n := 0
var _scrub_buf := {}             # id -> PackedFloat32Array


## Dirt the level is built with: numbered in build order (the same everywhere).
func register_stain(s: Node) -> void:
	_stain_n += 1
	var id := 900000 + _stain_n
	s.set_meta("net_gid", id)
	_graffiti[id] = s


## New dirt the host's world made (dirt_spawner.gd): made the same here.
func stain_new(p: Vector3, n: Vector3, ext: Vector2, kind: String, sd: int) -> void:
	if active and in_game and is_host:
		_stain_new.rpc(p, n, ext, kind, sd)


@rpc("authority", "call_remote", "reliable")
func _stain_new(p: Vector3, n: Vector3, ext: Vector2, kind: String, sd: int) -> void:
	if Game.main:
		load("res://scripts/world/stain.gd").make(Game.main, p, n, ext, kind, sd)


func stain_scrub(g: Node, xy: Vector2, radius: float, amount: float) -> void:
	if not active or not in_game or not g.has_meta("net_gid"):
		return
	var id := int(g.get_meta("net_gid"))
	var buf: PackedFloat32Array = _scrub_buf.get(id, PackedFloat32Array())
	buf.append_array([xy.x, xy.y, radius, amount])
	_scrub_buf[id] = buf


func _scrub_tick() -> void:
	if _scrub_buf.is_empty():
		return
	for id in _scrub_buf:
		_g_scrub.rpc(id, _scrub_buf[id])
	_scrub_buf.clear()


@rpc("any_peer", "call_remote", "reliable")
func _g_scrub(id: int, d: PackedFloat32Array) -> void:
	var g = _graffiti.get(id)
	if g == null or not is_instance_valid(g):
		return
	var G = load("res://scripts/world/graffiti.gd")
	G.from_net = true
	var left := 1.0
	var i := 0
	while i + 4 <= d.size():
		left = g.scrub(Vector2(d[i], d[i + 1]), d[i + 2], d[i + 3])
		i += 4
	G.from_net = false
	if left < 0.25:
		g.finish()
