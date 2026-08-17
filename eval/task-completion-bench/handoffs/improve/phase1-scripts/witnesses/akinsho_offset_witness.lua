-- SLATE-B W0 gate — P3 falsifier 1: HAND-AUTHORED WITNESS for akinsho/nvim-bufferline.lua#173.
--
-- Authored from the issue text and the base tree at 7bf463c only. The gold patch, the
-- hidden test patch, FAIL_TO_PASS and PASS_TO_PASS were not read.
--
-- The issue: bufferline offsets work over an NvimTree sidebar but not over an undotree
-- sidebar, even though the undotree window's filetype really is "undotree".
--
-- The base tree explains why without anyone having to say so. `M.get` gives up unless
-- `layout[1] == "row"`, and `is_offset_section` inspects only entries whose first element
-- is "leaf". undotree opens a stacked pair (the tree plus its diff panel), so the
-- boundary entry of the row is a "col" GROUP, not a leaf, and the search walks straight
-- past it. NvimTree is a single window, so it is a leaf and works. That is a structural
-- claim about the base code, not a guess about the fix.
--
-- The witness therefore drives the PUBLIC entry point `M.get(prefs)` — never the local
-- `is_offset_section`, which a fix is free to rename or replace — over layouts that a
-- real neovim produces, and checks both boundaries. Everything neovim-side is stubbed,
-- so the witness needs a Lua interpreter and nothing else.

local W = {}
local results = {}
local function check(name, fn)
  local ok, err = pcall(fn)
  results[#results + 1] = { name = name, ok = ok, err = ok and '' or tostring(err) }
end
local function assert_eq(got, want, what)
  if got ~= want then error((what or 'value') .. ': got ' .. tostring(got) .. ', want ' .. tostring(want), 2) end
end

-- ------------------------------------------------------------------ neovim stub
-- windows: { [win_id] = { filetype = "...", width = N } }
local WINDOWS = {}
local LAYOUT = {}

local function install_vim_stub()
  local bo = setmetatable({}, { __index = function(_, buf) return { filetype = (WINDOWS[buf] or {}).filetype } end })
  local wo = setmetatable({}, { __index = function() return { winhighlight = nil } end })
  _G.vim = {
    api = {
      nvim_win_get_buf = function(win) return win end,       -- buffer id == window id in the stub
      nvim_win_get_width = function(win) return (WINDOWS[win] or {}).width or 0 end,
      nvim_win_get_option = function(win, _) return (WINDOWS[win] or {}).filetype end,
      nvim_buf_get_option = function(buf, _) return (WINDOWS[buf] or {}).filetype end,
    },
    fn = {
      winlayout = function() return LAYOUT end,
      strwidth = function(s) return #tostring(s) end,
    },
    bo = bo,
    wo = wo,
    split = function(s, sep)
      local out = {}
      for piece in tostring(s):gmatch('([^' .. sep .. ']+)') do out[#out + 1] = piece end
      return out
    end,
    -- STUB GAP FIXED AFTER THE FREEZE (disclosed in the write-up): the first version
    -- stopped at `split` and `tbl_isempty`, so any tree whose fix reached for another
    -- vim.tbl_* helper died with "attempt to call a nil value" and was scored REJECT for
    -- a reason that had nothing to do with its behaviour. The reference fix was one of
    -- them. These are neovim's own list helpers, reimplemented from their documented
    -- behaviour; none of them encodes anything about the fix.
    tbl_isempty = function(t) return next(t) == nil end,
    tbl_islist = function(t)
      if type(t) ~= 'table' then return false end
      local n = 0
      for k in pairs(t) do
        if type(k) ~= 'number' then return false end
        n = n + 1
      end
      return n == #t
    end,
    tbl_contains = function(t, want)
      for _, v in pairs(t) do if v == want then return true end end
      return false
    end,
    tbl_filter = function(fn, t)
      local out = {}
      for _, v in ipairs(t) do if fn(v) then out[#out + 1] = v end end
      return out
    end,
    tbl_map = function(fn, t)
      local out = {}
      for i, v in ipairs(t) do out[i] = fn(v) end
      return out
    end,
    tbl_count = function(t)
      local n = 0
      for _ in pairs(t) do n = n + 1 end
      return n
    end,
    list_extend = function(dst, src)
      for _, v in ipairs(src) do dst[#dst + 1] = v end
      return dst
    end,
    deepcopy = function(t)
      local function copy(x)
        if type(x) ~= 'table' then return x end
        local out = {}
        for k, v in pairs(x) do out[copy(k)] = copy(v) end
        return out
      end
      return copy(t)
    end,
  }
  _G.vim.islist = _G.vim.tbl_islist
  -- offset.lua pulls this in lazily; a fix may or may not still use it.
  package.loaded['bufferline.highlights'] = { hl = function(name) return '%#' .. tostring(name or 'Fill') .. '#' end }
end

local function prefs(offsets)
  return { options = { offsets = offsets }, highlights = { fill = { hl = 'BufferLineFill' } } }
end

-- ---------------------------------------------------------------------- layouts
-- Shapes a real neovim produces. `winlayout()` returns nested {type, children} tables.
local function flat_left()   -- NvimTree: one leaf on the left. The base tree handles this.
  WINDOWS = { [1] = { filetype = 'NvimTree', width = 30 }, [2] = { filetype = 'lua', width = 100 } }
  LAYOUT = { 'row', { { 'leaf', 1 }, { 'leaf', 2 } } }
end
local function nested_left()  -- undotree: tree stacked over its diff panel, on the left.
  WINDOWS = { [10] = { filetype = 'undotree', width = 30 }, [11] = { filetype = 'diff', width = 30 },
              [2] = { filetype = 'lua', width = 100 } }
  LAYOUT = { 'row', { { 'col', { { 'leaf', 10 }, { 'leaf', 11 } } }, { 'leaf', 2 } } }
end
local function nested_right() -- the same sidebar opened on the right.
  WINDOWS = { [2] = { filetype = 'lua', width = 100 },
              [10] = { filetype = 'undotree', width = 30 }, [11] = { filetype = 'diff', width = 30 } }
  LAYOUT = { 'row', { { 'leaf', 2 }, { 'col', { { 'leaf', 10 }, { 'leaf', 11 } } } } }
end
local function row_inside_col()  -- a horizontal split above the whole thing.
  WINDOWS = { [10] = { filetype = 'undotree', width = 30 }, [11] = { filetype = 'diff', width = 30 },
              [2] = { filetype = 'lua', width = 100 }, [3] = { filetype = 'qf', width = 130 } }
  LAYOUT = { 'col', { { 'row', { { 'col', { { 'leaf', 10 }, { 'leaf', 11 } } }, { 'leaf', 2 } } }, { 'leaf', 3 } } }
end
local function no_sidebar()
  WINDOWS = { [1] = { filetype = 'lua', width = 60 }, [2] = { filetype = 'lua', width = 60 } }
  LAYOUT = { 'row', { { 'leaf', 1 }, { 'leaf', 2 } } }
end

-- ----------------------------------------------------------------------- checks
function W.run(offset_module_path)
  install_vim_stub()
  package.loaded['bufferline.offset'] = nil
  local M = dofile(offset_module_path)

  -- Sanity: the shape that already worked must keep working. A "fix" that breaks
  -- NvimTree to make undotree pass has not fixed anything.
  check('a flat NvimTree sidebar still offsets on the left', function()
    flat_left()
    local size, left, right = M.get(prefs({ { filetype = 'NvimTree', text = 'Explorer' } }))
    assert_eq(size, 30, 'total size')
    assert(left ~= '' and left ~= nil, 'left component must be filled')
    assert_eq(right, '', 'right component')
  end)

  -- The issue itself.
  check('a nested undotree sidebar offsets on the left', function()
    nested_left()
    local size, left, right = M.get(prefs({ { filetype = 'undotree', text = 'Undo' } }))
    assert_eq(size, 30, 'total size')
    assert(left ~= '' and left ~= nil, 'left component must be filled')
    assert_eq(right, '', 'right component')
  end)

  -- The other boundary. A fix that hard-codes "the first entry" passes the test above
  -- and fails this one.
  check('a nested undotree sidebar offsets on the right', function()
    nested_right()
    local size, left, right = M.get(prefs({ { filetype = 'undotree', text = 'Undo' } }))
    assert_eq(size, 30, 'total size')
    assert_eq(left, '', 'left component')
    assert(right ~= '' and right ~= nil, 'right component must be filled')
  end)

  -- Recursion, not one extra level of unwrapping.
  check('a row nested inside a column still finds the sidebar', function()
    row_inside_col()
    local size = M.get(prefs({ { filetype = 'undotree', text = 'Undo' } }))
    assert_eq(size, 30, 'total size')
  end)

  -- Negative control: no false offsets.
  check('no sidebar means no offset', function()
    no_sidebar()
    local size, left, right = M.get(prefs({ { filetype = 'undotree', text = 'Undo' } }))
    assert_eq(size, 0, 'total size')
    assert_eq(left, '', 'left component')
    assert_eq(right, '', 'right component')
  end)

  local failed = 0
  for _, r in ipairs(results) do
    if not r.ok then failed = failed + 1 end
    print(string.format('  %s  %s%s', r.ok and 'PASS' or 'FAIL', r.name, r.ok and '' or '  — ' .. r.err))
  end
  print(string.format('WITNESS %s (%d/%d)', failed == 0 and 'ACCEPT' or 'REJECT', #results - failed, #results))
  return failed
end

local target = arg and arg[1]
if target then os.exit(W.run(target) == 0 and 0 or 1) end
return W
