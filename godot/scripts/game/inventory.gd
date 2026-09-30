extends RefCounted
## A bag: a grid of cells, and the things in it, each taking up a block of
## cells (turned or not). Things of a kind that stack share one block up to
## their stack size.

signal changed

const Items = preload("res://scripts/game/items.gd")

var width := 10
var height := 7
## [{id, pos: Vector2i, rot: bool, count}]
var items: Array = []


func _init(w := 10, h := 7) -> void:
	width = w
	height = h


func cells_of(it: Dictionary) -> Rect2i:
	return Rect2i(it["pos"], Items.size_of(it["id"], it["rot"]))


## Whether a block of `size` fits at `pos` (not counting `ignore`).
func fits(size: Vector2i, pos: Vector2i, ignore: Dictionary = {}) -> bool:
	if pos.x < 0 or pos.y < 0 or pos.x + size.x > width or pos.y + size.y > height:
		return false
	var r := Rect2i(pos, size)
	for it in items:
		if it == ignore:
			continue
		if cells_of(it).intersects(r):
			return false
	return true


## The first place a thing fits (flat or turned), or null.
func find_room(id: String) -> Variant:
	for rot in [false, true]:
		var s := Items.size_of(id, rot)
		for y in height:
			for x in width:
				if fits(s, Vector2i(x, y)):
					return [Vector2i(x, y), rot]
	return null


## Puts `count` of `id` in: onto stacks not yet full first, then into free
## room. Returns how many did not fit.
func add(id: String, count := 1) -> int:
	var stack: int = Items.def(id)["stack"]
	for it in items:
		if count <= 0:
			break
		if it["id"] == id and int(it["count"]) < stack:
			var put := mini(stack - int(it["count"]), count)
			it["count"] = int(it["count"]) + put
			count -= put
	while count > 0:
		var room = find_room(id)
		if room == null:
			break
		var put := mini(stack, count)
		items.append({"id": id, "pos": room[0], "rot": room[1], "count": put})
		count -= put
	changed.emit()
	return count


func count(id: String) -> int:
	var n := 0
	for it in items:
		if it["id"] == id:
			n += int(it["count"])
	return n


func has(id: String) -> bool:
	return count(id) > 0


## Takes `n` of `id` out (from the smallest stacks first). Returns whether
## there were that many.
func take(id: String, n := 1) -> bool:
	if count(id) < n:
		return false
	var mine := items.filter(func(it): return it["id"] == id)
	mine.sort_custom(func(a, b): return int(a["count"]) < int(b["count"]))
	for it in mine:
		if n <= 0:
			break
		var t := mini(int(it["count"]), n)
		it["count"] = int(it["count"]) - t
		n -= t
		if int(it["count"]) <= 0:
			items.erase(it)
	changed.emit()
	return true


func remove(it: Dictionary) -> void:
	items.erase(it)
	changed.emit()


## Moves a thing to `pos` (turned or not) if it fits there.
func move(it: Dictionary, pos: Vector2i, rot: bool) -> bool:
	if not fits(Items.size_of(it["id"], rot), pos, it):
		return false
	it["pos"] = pos
	it["rot"] = rot
	changed.emit()
	return true


## The thing covering a cell, or {}.
func at(cell: Vector2i) -> Dictionary:
	for it in items:
		if cells_of(it).has_point(cell):
			return it
	return {}


func weight() -> float:
	var w := 0.0
	for it in items:
		w += float(Items.def(it["id"])["weight"]) * int(it["count"])
	return w
