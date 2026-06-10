#target photoshop
// SVG Advanced Importer v3.1
// Features: Group hierarchy → PS LayerSets, SVG transform matrix stack,
// fill + STROKE (color/width/opacity/cap/join) preservation, element opacity
// applied to layers, <use> dereferencing, proper arc-to-bezier, T/t smooth
// quadratic, even-odd holes (XOR), viewBox scaling, ScriptUI dialog with
// progress bar and import report.
// Note: fill-opacity is folded into layer opacity only when the shape has no
// stroke (PS solid-fill shape layers have a single layer opacity).

// ─── POLYFILLS ───────────────────────────────────────────────────────────────
if (!String.prototype.trim) {
    String.prototype.trim = function () {
        return this.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
    };
}
if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (v) {
        for (var i = 0; i < this.length; i++) if (this[i] === v) return i;
        return -1;
    };
}

// ─── MATRIX HELPERS ──────────────────────────────────────────────────────────
// Matrix: [a, b, c, d, e, f]  →  | a c e |
//                                 | b d f |
//                                 | 0 0 1 |
function identityMatrix() { return [1, 0, 0, 1, 0, 0]; }

function multiplyMatrix(m1, m2) {
    return [
        m1[0]*m2[0] + m1[2]*m2[1],
        m1[1]*m2[0] + m1[3]*m2[1],
        m1[0]*m2[2] + m1[2]*m2[3],
        m1[1]*m2[2] + m1[3]*m2[3],
        m1[0]*m2[4] + m1[2]*m2[5] + m1[4],
        m1[1]*m2[4] + m1[3]*m2[5] + m1[5]
    ];
}

function applyMatrix(m, x, y) {
    return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
}

function parseTransform(str) {
    if (!str || typeof str !== "string") return null;
    str = str.trim();
    var m = identityMatrix();
    // Match all transform functions
    var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]+)\)/gi;
    var match;
    while ((match = re.exec(str)) !== null) {
        var fn = match[1].toLowerCase();
        var nums = match[2].replace(/,/g, " ").split(/\s+/);
        var n = [];
        for (var i = 0; i < nums.length; i++) {
            var v = parseFloat(nums[i]);
            if (!isNaN(v)) n.push(v);
        }
        var t = identityMatrix();
        if (fn === "matrix" && n.length >= 6) {
            t = [n[0], n[1], n[2], n[3], n[4], n[5]];
        } else if (fn === "translate") {
            t[4] = n[0] || 0;
            t[5] = n.length > 1 ? n[1] : 0;
        } else if (fn === "scale") {
            t[0] = n[0] || 1;
            t[3] = n.length > 1 ? n[1] : n[0] || 1;
        } else if (fn === "rotate") {
            var ang = (n[0] || 0) * Math.PI / 180;
            var cos = Math.cos(ang), sin = Math.sin(ang);
            var cx = n.length > 2 ? n[1] : 0;
            var cy = n.length > 2 ? n[2] : 0;
            // rotate around cx,cy: translate(-cx,-cy) rotate translate(cx,cy)
            t = [cos, sin, -sin, cos, cx - cos*cx + sin*cy, cy - sin*cx - cos*cy];
        } else if (fn === "skewx") {
            t[2] = Math.tan((n[0] || 0) * Math.PI / 180);
        } else if (fn === "skewy") {
            t[1] = Math.tan((n[0] || 0) * Math.PI / 180);
        }
        m = multiplyMatrix(m, t);
    }
    return m;
}

// ─── ARC TO CUBIC BEZIER ─────────────────────────────────────────────────────
// Converts SVG arc params to array of cubic bezier segments [{x1,y1,x2,y2,x,y}]
function arcToCubics(x1, y1, rx, ry, xRot, largeArc, sweep, x2, y2) {
    var curves = [];
    if (x1 === x2 && y1 === y2) return curves;
    if (rx === 0 || ry === 0) {
        // Degenerate arc → straight line (represented as cubic with collinear handles)
        curves.push({x1:x1, y1:y1, x2:x2, y2:y2, x:x2, y:y2});
        return curves;
    }
    rx = Math.abs(rx); ry = Math.abs(ry);
    var phi = xRot * Math.PI / 180;
    var cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

    var dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    var x1p =  cosPhi * dx + sinPhi * dy;
    var y1p = -sinPhi * dx + cosPhi * dy;

    // Step 2: Check/fix radii
    var x1p2 = x1p * x1p, y1p2 = y1p * y1p;
    var rx2 = rx * rx, ry2 = ry * ry;
    var lambda = x1p2 / rx2 + y1p2 / ry2;
    if (lambda > 1) { var sl = Math.sqrt(lambda); rx *= sl; ry *= sl; rx2 = rx*rx; ry2 = ry*ry; }

    // Step 3: Compute centre
    var num = Math.max(0, rx2*ry2 - rx2*y1p2 - ry2*x1p2);
    var den = rx2*y1p2 + ry2*x1p2;
    var sq = (den === 0) ? 0 : Math.sqrt(num / den);
    if (largeArc === sweep) sq = -sq;
    var cxp =  sq * rx * y1p / ry;
    var cyp = -sq * ry * x1p / rx;

    var cx = cosPhi*cxp - sinPhi*cyp + (x1+x2)/2;
    var cy = sinPhi*cxp + cosPhi*cyp + (y1+y2)/2;

    // Step 4: Angles
    function angle(ux, uy, vx, vy) {
        var d = Math.sqrt(ux*ux+uy*uy) * Math.sqrt(vx*vx+vy*vy);
        if (d === 0) return 0;
        var c = Math.max(-1, Math.min(1, (ux*vx+uy*vy)/d));
        var a = Math.acos(c);
        if (ux*vy - uy*vx < 0) a = -a;
        return a;
    }
    var theta1 = angle(1, 0, (x1p-cxp)/rx, (y1p-cyp)/ry);
    var dTheta  = angle((x1p-cxp)/rx, (y1p-cyp)/ry, (-x1p-cxp)/rx, (-y1p-cyp)/ry);
    if (!sweep && dTheta > 0) dTheta -= 2*Math.PI;
    if ( sweep && dTheta < 0) dTheta += 2*Math.PI;

    // Split into segments ≤ 90°
    var segs = Math.ceil(Math.abs(dTheta) / (Math.PI / 2));
    if (segs === 0) segs = 1;
    var dThetaSeg = dTheta / segs;

    var curX = x1, curY = y1;
    for (var s = 0; s < segs; s++) {
        var t1 = theta1 + s * dThetaSeg;
        var t2 = theta1 + (s + 1) * dThetaSeg;
        var alpha = 4/3 * Math.tan((t2 - t1) / 4);

        var cos1 = Math.cos(t1), sin1 = Math.sin(t1);
        var cos2 = Math.cos(t2), sin2 = Math.sin(t2);

        var dx1 = cos1 - alpha*sin1, dy1 = sin1 + alpha*cos1;
        var dx2 = cos2 + alpha*sin2, dy2 = sin2 - alpha*cos2;

        var px1 = cx + cosPhi*rx*dx1 - sinPhi*ry*dy1;
        var py1 = cy + sinPhi*rx*dx1 + cosPhi*ry*dy1;
        var px2 = cx + cosPhi*rx*dx2 - sinPhi*ry*dy2;
        var py2 = cy + sinPhi*rx*dx2 + cosPhi*ry*dy2;
        var ex  = cx + cosPhi*rx*cos2 - sinPhi*ry*sin2;
        var ey  = cy + sinPhi*rx*cos2 + cosPhi*ry*sin2;

        curves.push({x1:px1, y1:py1, x2:px2, y2:py2, x:ex, y:ey});
        curX = ex; curY = ey;
    }
    return curves;
}

// ─── SVG ATTRIBUTE HELPERS ───────────────────────────────────────────────────
function parseAttributes(str) {
    var obj = {};
    // Handle both single and double quotes, and unquoted namespace attributes
    var re = /([\w:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    var m;
    while ((m = re.exec(str)) !== null) {
        obj[m[1]] = (m[2] !== undefined) ? m[2] : m[3];
    }
    return obj;
}

function getAttr(attrs, keys) {
    for (var i = 0; i < keys.length; i++) {
        if (attrs[keys[i]] !== undefined && attrs[keys[i]] !== null) return attrs[keys[i]];
    }
    return undefined;
}

// ─── FILL / OPACITY RESOLUTION ───────────────────────────────────────────────
function resolveFill(attrs, inheritedFill) {
    var fill = undefined;
    // Check inline style first
    if (attrs.style) {
        var fm = attrs.style.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i);
        if (fm) fill = fm[1].trim();
    }
    if (fill === undefined && attrs.fill !== undefined) fill = attrs.fill.trim();
    if (fill === undefined || fill === "inherit") fill = inheritedFill || "#000000";
    if (fill === "none" || fill === "transparent") return null;
    return fill;
}

function resolveOpacity(attrs, inheritedOpacity) {
    var op = 1.0;
    if (attrs.style) {
        var om = attrs.style.match(/(?:^|;)\s*opacity\s*:\s*([^;]+)/i);
        if (om) op = parseFloat(om[1]);
    }
    if (attrs.opacity !== undefined) op = parseFloat(attrs.opacity);
    if (isNaN(op)) op = 1.0;
    return op * (inheritedOpacity !== undefined ? inheritedOpacity : 1.0);
}

function styleProp(attrs, prop) {
    if (attrs.style) {
        var m = attrs.style.match(new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i"));
        if (m) return m[1].trim();
    }
    if (attrs[prop] !== undefined) return String(attrs[prop]).trim();
    return undefined;
}

function resolveStroke(attrs, inherited) {
    var s = styleProp(attrs, "stroke");
    if (s === undefined || s === "inherit") s = inherited;     // may be undefined/null
    if (s === "none" || s === "transparent") return null;
    return s || null;
}

function resolveStrokeWidth(attrs, inherited) {
    var w = styleProp(attrs, "stroke-width");
    if (w === undefined) return (inherited !== undefined) ? inherited : 1;
    var v = parseFloat(w);
    return isNaN(v) ? 1 : v;
}

function resolveStrokeOpacity(attrs, inherited) {
    var o = styleProp(attrs, "stroke-opacity");
    if (o === undefined) return (inherited !== undefined) ? inherited : 1;
    var v = parseFloat(o);
    return isNaN(v) ? 1 : v;
}

function resolveFillOpacity(attrs, inherited) {
    var o = styleProp(attrs, "fill-opacity");
    if (o === undefined) return (inherited !== undefined) ? inherited : 1;
    var v = parseFloat(o);
    return isNaN(v) ? 1 : v;
}

function resolveLineCap(attrs, inherited) {
    return styleProp(attrs, "stroke-linecap") || inherited || "butt";
}

function resolveLineJoin(attrs, inherited) {
    return styleProp(attrs, "stroke-linejoin") || inherited || "miter";
}

function matrixScale(m) {
    // Average absolute scale factor — used to scale stroke widths
    var det = m[0]*m[3] - m[1]*m[2];
    return Math.sqrt(Math.abs(det));
}

function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v || 0))); }

function parseColor(fill) {
    if (!fill || typeof fill !== "string") return [0, 0, 0];
    fill = fill.trim().toLowerCase();
    if (fill.charAt(0) === '#') {
        var h = fill.slice(1);
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        if (h.length === 6) return [parseInt(h.slice(0,2),16)||0, parseInt(h.slice(2,4),16)||0, parseInt(h.slice(4,6),16)||0];
    }
    if (fill.indexOf("rgb") === 0) {
        var parts = fill.match(/[\d.]+/g);
        if (parts && parts.length >= 3) {
            var r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
            // Handle percentage rgb
            if (fill.indexOf("%") !== -1) { r=r/100*255; g=g/100*255; b=b/100*255; }
            return [Math.round(r), Math.round(g), Math.round(b)];
        }
    }
    var named = {
        red:[255,0,0], green:[0,128,0], lime:[0,255,0], blue:[0,0,255],
        white:[255,255,255], black:[0,0,0], yellow:[255,255,0],
        orange:[255,165,0], purple:[128,0,128], cyan:[0,255,255],
        magenta:[255,0,255], gray:[128,128,128], grey:[128,128,128],
        silver:[192,192,192], maroon:[128,0,0], navy:[0,0,128],
        teal:[0,128,128], fuchsia:[255,0,255], aqua:[0,255,255]
    };
    return named[fill] || [0, 0, 0];
}

// ─── SVG TOKENIZER / MINI-PARSER ─────────────────────────────────────────────
// Returns a flat list of nodes: {type:'open'|'self'|'close'|'text', tag, attrs, raw}
function tokenizeSVG(svg) {
    var nodes = [];
    // Strip XML declaration, DOCTYPE, comments, CDATA
    svg = svg.replace(/<\?[^?]*\?>/g, "")
             .replace(/<!DOCTYPE[^>]*>/gi, "")
             .replace(/<!--[\s\S]*?-->/g, "")
             .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

    var tagRe = /<(\/?)(\w[\w:-]*)((?:\s+(?:[\w:_-]+)\s*=\s*(?:"[^"]*"|'[^']*'))*(?:\s+[\w:_-]+)*\s*)(\/?)\s*>/g;
    var lastIndex = 0;
    var m;
    while ((m = tagRe.exec(svg)) !== null) {
        if (m[1] === "/") {
            nodes.push({ type: "close", tag: m[2].toLowerCase() });
        } else if (m[4] === "/") {
            nodes.push({ type: "self", tag: m[2].toLowerCase(), attrs: parseAttributes(m[3]) });
        } else {
            nodes.push({ type: "open", tag: m[2].toLowerCase(), attrs: parseAttributes(m[3]) });
        }
    }
    return nodes;
}

// ─── DEFS / USE RESOLVER ─────────────────────────────────────────────────────
function extractDefs(nodes) {
    var defs = {}; // id → node index range or attrs
    var inDefs = false;
    var depth = 0;
    var defsContent = []; // collected nodes inside <defs>
    var stack = [];

    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.type === "open" && n.tag === "defs") { inDefs = true; depth = 0; continue; }
        if (inDefs) {
            if (n.type === "open") { depth++; }
            if (n.type === "close" && n.tag === "defs") { inDefs = false; continue; }
            if (n.type === "close") { depth--; }
            defsContent.push(n);
            // Index by id
            if ((n.type === "open" || n.type === "self") && n.attrs && n.attrs.id) {
                defs[n.attrs.id] = n;
            }
        } else {
            if ((n.type === "open" || n.type === "self") && n.attrs && n.attrs.id) {
                defs[n.attrs.id] = n;
            }
        }
    }
    return defs;
}

// ─── PATH TOKENIZER ──────────────────────────────────────────────────────────
function tokenizePathD(d) {
    var tokens = [];
    var re = /([MmZzLlHhVvCcSsQqTtAa])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
    var m;
    while ((m = re.exec(d)) !== null) {
        tokens.push(m[1] ? m[1] : parseFloat(m[2]));
    }
    return tokens;
}

// ─── SVG PATH "d" → SUBPATH SEGMENTS ────────────────────────────────────────
function svgPathToSegments(d) {
    var segments = [];
    var currentSubpath = null;
    var cx = 0, cy = 0;
    var lastCX = 0, lastCY = 0; // last cubic control point
    var lastQX = 0, lastQY = 0; // last quadratic control point
    var startX = 0, startY = 0;
    var lastCmd = "";

    function newSubpath() {
        currentSubpath = { points: [], closed: false };
    }
    function flushSubpath() {
        if (currentSubpath && currentSubpath.points.length > 0) {
            segments.push(currentSubpath);
        }
        currentSubpath = null;
    }
    function pushPoint(ax, ay, ix, iy, ox, oy) {
        if (!currentSubpath) newSubpath();
        currentSubpath.points.push({ ax:ax, ay:ay, ix:ix, iy:iy, ox:ox, oy:oy });
    }
    function updateLastOut(ox, oy) {
        if (currentSubpath && currentSubpath.points.length > 0) {
            var last = currentSubpath.points[currentSubpath.points.length - 1];
            last.ox = ox; last.oy = oy;
        }
    }

    var tokens = tokenizePathD(d);
    var i = 0;

    while (i < tokens.length) {
        var cmd = tokens[i];
        if (typeof cmd !== "string") { i++; continue; }
        i++;
        var isRel = (cmd === cmd.toLowerCase() && cmd.toLowerCase() !== 'z');
        var c = cmd.toUpperCase();
        lastCmd = c;

        if (c === 'M') {
            flushSubpath();
            var x = +tokens[i++]; var y = +tokens[i++];
            if (isRel && segments.length > 0) { x += cx; y += cy; }
            cx = x; cy = y; startX = cx; startY = cy;
            newSubpath();
            pushPoint(cx, cy, cx, cy, cx, cy);
            lastCX = cx; lastCY = cy; lastQX = cx; lastQY = cy;
            // Subsequent coords are implicit L
            while (i < tokens.length && typeof tokens[i] === "number") {
                x = +tokens[i++]; y = +tokens[i++];
                if (isRel) { x += cx; y += cy; }
                cx = x; cy = y;
                pushPoint(cx, cy, cx, cy, cx, cy);
                lastCX = cx; lastCY = cy; lastQX = cx; lastQY = cy;
            }

        } else if (c === 'Z') {
            if (currentSubpath) { currentSubpath.closed = true; }
            flushSubpath();
            cx = startX; cy = startY;

        } else if (c === 'L') {
            while (i < tokens.length && typeof tokens[i] === "number") {
                var x = +tokens[i++]; var y = +tokens[i++];
                if (isRel) { x += cx; y += cy; }
                cx = x; cy = y;
                pushPoint(cx, cy, cx, cy, cx, cy);
                lastCX = cx; lastCY = cy; lastQX = cx; lastQY = cy;
            }

        } else if (c === 'H') {
            while (i < tokens.length && typeof tokens[i] === "number") {
                var x = +tokens[i++];
                if (isRel) x += cx;
                cx = x;
                pushPoint(cx, cy, cx, cy, cx, cy);
                lastCX = cx; lastQX = cx;
            }

        } else if (c === 'V') {
            while (i < tokens.length && typeof tokens[i] === "number") {
                var y = +tokens[i++];
                if (isRel) y += cy;
                cy = y;
                pushPoint(cx, cy, cx, cy, cx, cy);
                lastCY = cy; lastQY = cy;
            }

        } else if (c === 'C') {
            while (i < tokens.length && typeof tokens[i] === "number") {
                var x1=+tokens[i++], y1=+tokens[i++];
                var x2=+tokens[i++], y2=+tokens[i++];
                var x =+tokens[i++], y =+tokens[i++];
                if (isRel) { x1+=cx; y1+=cy; x2+=cx; y2+=cy; x+=cx; y+=cy; }
                updateLastOut(x1, y1);
                lastCX = x2; lastCY = y2;
                cx = x; cy = y;
                pushPoint(cx, cy, x2, y2, cx, cy);
                lastQX = cx; lastQY = cy;
            }

        } else if (c === 'S') {
            while (i < tokens.length && typeof tokens[i] === "number") {
                var x2=+tokens[i++], y2=+tokens[i++];
                var x =+tokens[i++], y =+tokens[i++];
                if (isRel) { x2+=cx; y2+=cy; x+=cx; y+=cy; }
                // Reflect last cubic control
                var x1 = (lastCmd === 'C' || lastCmd === 'S') ? 2*cx - lastCX : cx;
                var y1 = (lastCmd === 'C' || lastCmd === 'S') ? 2*cy - lastCY : cy;
                updateLastOut(x1, y1);
                lastCX = x2; lastCY = y2;
                cx = x; cy = y;
                pushPoint(cx, cy, x2, y2, cx, cy);
                lastQX = cx; lastQY = cy;
                lastCmd = 'S';
            }

        } else if (c === 'Q') {
            while (i < tokens.length && typeof tokens[i] === "number") {
                var qx1=+tokens[i++], qy1=+tokens[i++];
                var x  =+tokens[i++], y  =+tokens[i++];
                if (isRel) { qx1+=cx; qy1+=cy; x+=cx; y+=cy; }
                // Q → cubic: cp1 = curr + 2/3*(q-curr), cp2 = end + 2/3*(q-end)
                var cx1 = cx  + 2/3*(qx1-cx);  var cy1 = cy  + 2/3*(qy1-cy);
                var cx2 = x   + 2/3*(qx1-x);   var cy2 = y   + 2/3*(qy1-y);
                updateLastOut(cx1, cy1);
                lastQX = qx1; lastQY = qy1;
                lastCX = cx2; lastCY = cy2;
                cx = x; cy = y;
                pushPoint(cx, cy, cx2, cy2, cx, cy);
                lastCmd = 'Q';
            }

        } else if (c === 'T') {
            // Smooth quadratic — reflect last quadratic control point
            while (i < tokens.length && typeof tokens[i] === "number") {
                var x=+tokens[i++], y=+tokens[i++];
                if (isRel) { x+=cx; y+=cy; }
                var qx1 = (lastCmd === 'Q' || lastCmd === 'T') ? 2*cx - lastQX : cx;
                var qy1 = (lastCmd === 'Q' || lastCmd === 'T') ? 2*cy - lastQY : cy;
                var cx1 = cx + 2/3*(qx1-cx); var cy1 = cy + 2/3*(qy1-cy);
                var cx2 = x  + 2/3*(qx1-x);  var cy2 = y  + 2/3*(qy1-y);
                updateLastOut(cx1, cy1);
                lastQX = qx1; lastQY = qy1;
                lastCX = cx2; lastCY = cy2;
                cx = x; cy = y;
                pushPoint(cx, cy, cx2, cy2, cx, cy);
                lastCmd = 'T';
            }

        } else if (c === 'A') {
            while (i < tokens.length && typeof tokens[i] === "number") {
                var rx=+tokens[i++], ry=+tokens[i++], xRot=+tokens[i++];
                var largeArc=!!Math.round(+tokens[i++]), sweep=!!Math.round(+tokens[i++]);
                var x=+tokens[i++], y=+tokens[i++];
                if (isRel) { x+=cx; y+=cy; }
                var curves = arcToCubics(cx, cy, rx, ry, xRot, largeArc, sweep, x, y);
                for (var ci = 0; ci < curves.length; ci++) {
                    var cv = curves[ci];
                    updateLastOut(cv.x1, cv.y1);
                    lastCX = cv.x2; lastCY = cv.y2;
                    cx = cv.x; cy = cv.y;
                    pushPoint(cx, cy, cv.x2, cv.y2, cx, cy);
                }
                lastQX = cx; lastQY = cy;
            }
        }
        lastCmd = c;
    }
    flushSubpath();
    return segments;
}

// ─── PRIMITIVE → SEGMENTS ────────────────────────────────────────────────────
function rectToSegments(a) {
    var x=parseFloat(a.x||0), y=parseFloat(a.y||0);
    var w=parseFloat(a.width||0), h=parseFloat(a.height||0);
    var rx=parseFloat(a.rx||a.ry||0), ry=parseFloat(a.ry||a.rx||0);
    if (rx > w/2) rx = w/2;
    if (ry > h/2) ry = h/2;
    if (rx === 0 && ry === 0) {
        return [{ points:[
            {ax:x,   ay:y,   ix:x,   iy:y,   ox:x,   oy:y},
            {ax:x+w, ay:y,   ix:x+w, iy:y,   ox:x+w, oy:y},
            {ax:x+w, ay:y+h, ix:x+w, iy:y+h, ox:x+w, oy:y+h},
            {ax:x,   ay:y+h, ix:x,   iy:y+h, ox:x,   oy:y+h}
        ], closed:true }];
    }
    // Rounded rect via path
    var k = 0.5522847498;
    var pts = [
        {ax:x+rx,   ay:y,     ix:x+rx-rx*k, iy:y,       ox:x+rx+rx*k,   oy:y},
        {ax:x+w-rx, ay:y,     ix:x+w-rx-rx*k,iy:y,      ox:x+w-rx+rx*k, oy:y},  // dummy, will be corner
        // ... simplified: just linearize rounded rects
    ];
    // Fallback: generate via arc-approximation using arcToCubics (simplified path)
    var pathD = "M"+(x+rx)+","+y
        +" H"+(x+w-rx)
        +" A"+rx+","+ry+",0,0,1,"+(x+w)+","+(y+ry)
        +" V"+(y+h-ry)
        +" A"+rx+","+ry+",0,0,1,"+(x+w-rx)+","+(y+h)
        +" H"+(x+rx)
        +" A"+rx+","+ry+",0,0,1,"+x+","+(y+h-ry)
        +" V"+(y+ry)
        +" A"+rx+","+ry+",0,0,1,"+(x+rx)+","+y
        +" Z";
    return svgPathToSegments(pathD);
}

function ellipseToSegments(cx, cy, rx, ry) {
    var k = 0.5522847498;
    return [{ points:[
        {ax:cx,    ay:cy-ry, ix:cx-rx*k, iy:cy-ry,    ox:cx+rx*k, oy:cy-ry},
        {ax:cx+rx, ay:cy,    ix:cx+rx,   iy:cy-ry*k,  ox:cx+rx,   oy:cy+ry*k},
        {ax:cx,    ay:cy+ry, ix:cx+rx*k, iy:cy+ry,    ox:cx-rx*k, oy:cy+ry},
        {ax:cx-rx, ay:cy,    ix:cx-rx,   iy:cy+ry*k,  ox:cx-rx,   oy:cy-ry*k}
    ], closed:true }];
}

function polyToSegments(pointsStr, closed) {
    var nums = String(pointsStr).replace(/,/g, " ").split(/\s+/);
    var pts = [];
    for (var i = 0; i + 1 < nums.length; i += 2) {
        var x = parseFloat(nums[i]), y = parseFloat(nums[i+1]);
        if (!isNaN(x) && !isNaN(y)) pts.push({ax:x, ay:y, ix:x, iy:y, ox:x, oy:y});
    }
    return pts.length > 0 ? [{ points:pts, closed:closed }] : [];
}

function shapeToSegments(attrs) {
    var tag = attrs._tag;
    if (tag === "path")     return svgPathToSegments(attrs.d || "");
    if (tag === "rect")     return rectToSegments(attrs);
    if (tag === "circle")   return ellipseToSegments(parseFloat(attrs.cx||0), parseFloat(attrs.cy||0), parseFloat(attrs.r||0), parseFloat(attrs.r||0));
    if (tag === "ellipse")  return ellipseToSegments(parseFloat(attrs.cx||0), parseFloat(attrs.cy||0), parseFloat(attrs.rx||0), parseFloat(attrs.ry||0));
    if (tag === "polygon")  return polyToSegments(attrs.points || "", true);
    if (tag === "polyline") return polyToSegments(attrs.points || "", false);
    if (tag === "line") {
        var x1=parseFloat(attrs.x1||0), y1=parseFloat(attrs.y1||0);
        var x2=parseFloat(attrs.x2||0), y2=parseFloat(attrs.y2||0);
        return [{ points:[{ax:x1,ay:y1,ix:x1,iy:y1,ox:x1,oy:y1},{ax:x2,ay:y2,ix:x2,iy:y2,ox:x2,oy:y2}], closed:false }];
    }
    return [];
}

// ─── APPLY MATRIX TO SEGMENTS ────────────────────────────────────────────────
function transformSegments(segs, matrix) {
    for (var s = 0; s < segs.length; s++) {
        var pts = segs[s].points;
        for (var p = 0; p < pts.length; p++) {
            var pt = pts[p];
            var a = applyMatrix(matrix, pt.ax, pt.ay);
            var inp = applyMatrix(matrix, pt.ix, pt.iy);
            var out = applyMatrix(matrix, pt.ox, pt.oy);
            pt.ax = a.x;  pt.ay = a.y;
            pt.ix = inp.x; pt.iy = inp.y;
            pt.ox = out.x; pt.oy = out.y;
        }
    }
    return segs;
}

// ─── TREE WALKER ─────────────────────────────────────────────────────────────
// Returns a flat list of shape descriptors with resolved fill, matrix, name, groupPath
var SHAPE_TAGS = { path:1, rect:1, circle:1, ellipse:1, polygon:1, polyline:1, line:1 };

function walkNodes(nodes, defs) {
    var shapes = [];
    // Stack entries: {matrix, fill, opacity, groupPath, name}
    var stack = [{ matrix: identityMatrix(), fill: "#000000", opacity: 1.0,
                   stroke: null, strokeWidth: 1, strokeOpacity: 1, fillOpacity: 1,
                   lineCap: "butt", lineJoin: "miter", groupPath: [], name: "" }];
    var groupCounters = [{}]; // per-depth auto-naming counters

    function top() { return stack[stack.length - 1]; }

    function groupName(attrs, depth) {
        var n = getAttr(attrs, ["inkscape:label", "data-name", "id", "name"]);
        if (n) return n;
        // Auto-name
        var counters = groupCounters[depth] || {};
        var key = "g";
        counters[key] = (counters[key] || 0) + 1;
        groupCounters[depth] = counters;
        return "Group " + counters[key];
    }

    var depth = 0;

    for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];

        if (n.type === "open" && n.tag === "defs") {
            // skip defs subtree
            var dd = 1;
            while (++i < nodes.length) {
                if (nodes[i].type === "open") dd++;
                if (nodes[i].type === "close") { dd--; if (dd <= 0) break; }
            }
            continue;
        }

        if (n.type === "open" && n.tag === "svg") {
            // push identity — viewBox handled at caller level
            var t0 = top();
            stack.push({ matrix: t0.matrix, fill: t0.fill, opacity: t0.opacity,
                         stroke: t0.stroke, strokeWidth: t0.strokeWidth, strokeOpacity: t0.strokeOpacity,
                         fillOpacity: t0.fillOpacity, lineCap: t0.lineCap, lineJoin: t0.lineJoin,
                         groupPath: t0.groupPath.slice(), name: "svg" });
            depth++;
            if (!groupCounters[depth]) groupCounters[depth] = {};
            continue;
        }

        if (n.type === "open" && n.tag === "g") {
            var parentState = top();
            var gm = parseTransform(getAttr(n.attrs, ["transform"]));
            var newMatrix = gm ? multiplyMatrix(parentState.matrix, gm) : parentState.matrix;
            var newFill = resolveFill(n.attrs, parentState.fill);
            if (newFill === null) newFill = parentState.fill; // groups: null fill means inherit
            var newOpacity = resolveOpacity(n.attrs, parentState.opacity);
            var newStroke    = resolveStroke(n.attrs, parentState.stroke);
            var newStrokeW   = resolveStrokeWidth(n.attrs, parentState.strokeWidth);
            var newStrokeOp  = resolveStrokeOpacity(n.attrs, parentState.strokeOpacity);
            var newFillOp    = resolveFillOpacity(n.attrs, parentState.fillOpacity);
            var newCap       = resolveLineCap(n.attrs, parentState.lineCap);
            var newJoin      = resolveLineJoin(n.attrs, parentState.lineJoin);
            var gName = groupName(n.attrs, depth);
            var newGroupPath = parentState.groupPath.concat([gName]);
            depth++;
            if (!groupCounters[depth]) groupCounters[depth] = {};
            stack.push({ matrix: newMatrix, fill: newFill, opacity: newOpacity,
                         stroke: newStroke, strokeWidth: newStrokeW, strokeOpacity: newStrokeOp,
                         fillOpacity: newFillOp, lineCap: newCap, lineJoin: newJoin,
                         groupPath: newGroupPath, name: gName });
            continue;
        }

        if (n.type === "close" && (n.tag === "g" || n.tag === "svg")) {
            if (stack.length > 1) { stack.pop(); depth--; }
            continue;
        }

        // <use> dereferencing
        if ((n.type === "open" || n.type === "self") && n.tag === "use") {
            var href = getAttr(n.attrs, ["href", "xlink:href"]);
            if (href && href.charAt(0) === "#") {
                var refId = href.slice(1);
                var refNode = defs[refId];
                if (refNode && SHAPE_TAGS[refNode.tag]) {
                    // Merge <use> transform and x/y offset into matrix
                    var useM = parseTransform(getAttr(n.attrs, ["transform"])) || identityMatrix();
                    var ux = parseFloat(n.attrs.x || 0), uy = parseFloat(n.attrs.y || 0);
                    if (ux !== 0 || uy !== 0) {
                        var tM = identityMatrix(); tM[4] = ux; tM[5] = uy;
                        useM = multiplyMatrix(useM, tM);
                    }
                    var mergedAttrs = {};
                    for (var k in refNode.attrs) mergedAttrs[k] = refNode.attrs[k];
                    for (var k in n.attrs) { if (k !== "href" && k !== "xlink:href") mergedAttrs[k] = n.attrs[k]; }
                    mergedAttrs._tag = refNode.tag;
                    var parentState2 = top();
                    var finalM = multiplyMatrix(parentState2.matrix, useM);
                    var useFill = resolveFill(mergedAttrs, parentState2.fill);
                    var shapeName = getAttr(mergedAttrs, ["inkscape:label","data-name","id"]) || refId;
                    shapes.push({ attrs: mergedAttrs, fill: useFill, matrix: finalM,
                                  stroke: resolveStroke(mergedAttrs, parentState2.stroke),
                                  strokeWidth: resolveStrokeWidth(mergedAttrs, parentState2.strokeWidth),
                                  strokeOpacity: resolveStrokeOpacity(mergedAttrs, parentState2.strokeOpacity),
                                  fillOpacity: resolveFillOpacity(mergedAttrs, parentState2.fillOpacity),
                                  opacity: resolveOpacity(mergedAttrs, parentState2.opacity),
                                  lineCap: resolveLineCap(mergedAttrs, parentState2.lineCap),
                                  lineJoin: resolveLineJoin(mergedAttrs, parentState2.lineJoin),
                                  groupPath: parentState2.groupPath.slice(), name: shapeName });
                }
            }
            if (n.type === "open") {
                // skip children
                var dd2 = 1;
                while (++i < nodes.length) {
                    if (nodes[i].type === "open") dd2++;
                    if (nodes[i].type === "close") { dd2--; if (dd2 <= 0) break; }
                }
            }
            continue;
        }

        // Shape elements
        if ((n.type === "open" || n.type === "self") && SHAPE_TAGS[n.tag]) {
            var parentState3 = top();
            var shapeM = parseTransform(getAttr(n.attrs, ["transform"]));
            var finalMatrix = shapeM ? multiplyMatrix(parentState3.matrix, shapeM) : parentState3.matrix;
            var shapeFill = resolveFill(n.attrs, parentState3.fill);
            var shapeName2 = getAttr(n.attrs, ["inkscape:label","data-name","id","name"]) || n.tag;
            var mergedA = {};
            for (var k2 in n.attrs) mergedA[k2] = n.attrs[k2];
            mergedA._tag = n.tag;
            shapes.push({ attrs: mergedA, fill: shapeFill, matrix: finalMatrix,
                          stroke: resolveStroke(n.attrs, parentState3.stroke),
                          strokeWidth: resolveStrokeWidth(n.attrs, parentState3.strokeWidth),
                          strokeOpacity: resolveStrokeOpacity(n.attrs, parentState3.strokeOpacity),
                          fillOpacity: resolveFillOpacity(n.attrs, parentState3.fillOpacity),
                          opacity: resolveOpacity(n.attrs, parentState3.opacity),
                          lineCap: resolveLineCap(n.attrs, parentState3.lineCap),
                          lineJoin: resolveLineJoin(n.attrs, parentState3.lineJoin),
                          groupPath: parentState3.groupPath.slice(), name: shapeName2 });
            // If open tag (not self-closing path), skip to close — unusual but possible
            if (n.type === "open") {
                var dd3 = 1;
                while (++i < nodes.length) {
                    if (nodes[i].type === "open") dd3++;
                    if (nodes[i].type === "close") { dd3--; if (dd3 <= 0) break; }
                }
            }
        }
    }
    return shapes;
}

// ─── PHOTOSHOP LAYER GROUP HELPERS ───────────────────────────────────────────
function makeLayerSet(name, parentRef) {
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(stringIDToTypeID("layerSection"));
    desc.putReference(charIDToTypeID("null"), ref);
    var layerDesc = new ActionDescriptor();
    layerDesc.putString(charIDToTypeID("Nm  "), String(name));
    desc.putObject(charIDToTypeID("Usng"), stringIDToTypeID("layerSection"), layerDesc);
    if (parentRef) desc.putReference(stringIDToTypeID("layerSectionType"), parentRef);
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
    return app.activeDocument.activeLayer; // newly created group
}

function moveLayerIntoGroup(layer, group) {
    var desc = new ActionDescriptor();
    var ref1 = new ActionReference();
    ref1.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    desc.putReference(charIDToTypeID("null"), ref1);
    var ref2 = new ActionReference();
    ref2.putIdentifier(charIDToTypeID("Lyr "), group.id);
    desc.putEnumerated(stringIDToTypeID("moveToBeginning"), stringIDToTypeID("moveToBeginning"), stringIDToTypeID("moveToBeginning"));
    desc.putReference(stringIDToTypeID("to"), ref2);
    try { executeAction(stringIDToTypeID("move"), desc, DialogModes.NO); } catch(e) {}
}

// Navigate/create nested LayerSet hierarchy from groupPath array
// Cache: groupCache[pathKey] = LayerSet
var groupCache = {};

function getOrCreateGroup(doc, groupPath, fileGroup) {
    if (!groupPath || groupPath.length === 0) return fileGroup;
    var key = groupPath.join("/");
    if (groupCache[key]) return groupCache[key];

    var parentKey = groupPath.slice(0, -1).join("/");
    var parent = groupPath.length === 1 ? fileGroup : groupCache[parentKey];
    if (!parent) parent = getOrCreateGroup(doc, groupPath.slice(0, -1), fileGroup);

    // Make the group inside parent by selecting parent first
    doc.activeLayer = parent;
    var newGroup = makeLayerSet(groupPath[groupPath.length - 1], null);
    // Mk layerSection may create a SIBLING of the selected group depending on
    // selection state — force deterministic nesting.
    try { newGroup.move(parent, ElementPlacement.INSIDE); } catch (eMv) {}
    groupCache[key] = newGroup;
    return newGroup;
}

// ─── PHOTOSHOP SHAPE LAYER CREATOR ───────────────────────────────────────────
// o: { name, fill:[r,g,b]|null, stroke:[r,g,b]|null, strokeWidth, strokeOpacity,
//      lineCap, lineJoin, layerOpacity (0-100), xor (bool) }
function buildStrokeStyleDesc(o) {
    var sid = stringIDToTypeID;
    var sDesc = new ActionDescriptor();
    sDesc.putInteger(sid("strokeStyleVersion"), 2);   // REQUIRED — PS rejects descriptor without it
    sDesc.putBoolean(sid("strokeEnabled"), !!o.stroke);
    sDesc.putBoolean(sid("fillEnabled"), !!o.fill);
    sDesc.putUnitDouble(sid("strokeStyleLineWidth"), charIDToTypeID("#Pxl"), Math.max(0.01, o.strokeWidth || 1));
    sDesc.putUnitDouble(sid("strokeStyleLineDashOffset"), charIDToTypeID("#Pnt"), 0);
    sDesc.putDouble(sid("strokeStyleMiterLimit"), 100);

    var capMap  = { butt: "strokeStyleButtCap", round: "strokeStyleRoundCap", square: "strokeStyleSquareCap" };
    var joinMap = { miter: "strokeStyleMiterJoin", round: "strokeStyleRoundJoin", bevel: "strokeStyleBevelJoin" };
    sDesc.putEnumerated(sid("strokeStyleLineCapType"),  sid("strokeStyleLineCapType"),  sid(capMap[o.lineCap]   || "strokeStyleButtCap"));
    sDesc.putEnumerated(sid("strokeStyleLineJoinType"), sid("strokeStyleLineJoinType"), sid(joinMap[o.lineJoin] || "strokeStyleMiterJoin"));
    sDesc.putEnumerated(sid("strokeStyleLineAlignment"), sid("strokeStyleLineAlignment"), sid("strokeStyleAlignCenter"));
    sDesc.putBoolean(sid("strokeStyleScaleLock"), false);
    sDesc.putBoolean(sid("strokeStyleStrokeAdjust"), false);
    sDesc.putList(sid("strokeStyleLineDashSet"), new ActionList());
    sDesc.putEnumerated(sid("strokeStyleBlendMode"), charIDToTypeID("BlnM"), charIDToTypeID("Nrml"));
    var sOp = (o.strokeOpacity !== undefined) ? o.strokeOpacity : 1;
    sDesc.putUnitDouble(sid("strokeStyleOpacity"), charIDToTypeID("#Prc"), Math.round(sOp * 100));

    var sRGB = o.stroke || [0, 0, 0];
    var scCol = new ActionDescriptor();
    scCol.putDouble(charIDToTypeID("Rd  "), clamp255(sRGB[0]));
    scCol.putDouble(charIDToTypeID("Grn "), clamp255(sRGB[1]));
    scCol.putDouble(charIDToTypeID("Bl  "), clamp255(sRGB[2]));
    var scDesc = new ActionDescriptor();
    scDesc.putObject(sid("color"), sid("RGBColor"), scCol);
    sDesc.putObject(sid("strokeStyleContent"), sid("solidColorLayer"), scDesc);
    sDesc.putDouble(sid("strokeStyleResolution"), 72);
    return sDesc;
}

function createShapeLayer(subpaths, o) {
    if (!subpaths || subpaths.length === 0) return null;
    var sid = stringIDToTypeID;

    var desc1 = new ActionDescriptor();
    var ref1 = new ActionReference();
    ref1.putClass(sid("contentLayer"));
    desc1.putReference(charIDToTypeID("null"), ref1);

    var desc2 = new ActionDescriptor();

    // Fill content — PS requires a color object even when fill is disabled
    var fillRGB = o.fill || [255, 255, 255];
    var desc4 = new ActionDescriptor();
    desc4.putDouble(charIDToTypeID("Rd  "), clamp255(fillRGB[0]));
    desc4.putDouble(charIDToTypeID("Grn "), clamp255(fillRGB[1]));
    desc4.putDouble(charIDToTypeID("Bl  "), clamp255(fillRGB[2]));
    var desc3 = new ActionDescriptor();
    desc3.putObject(sid("color"), sid("RGBColor"), desc4);
    desc2.putObject(sid("type"), sid("solidColorLayer"), desc3);

    // Stroke style (also carries fillEnabled flag)
    desc2.putObject(sid("strokeStyle"), sid("strokeStyle"), buildStrokeStyleDesc(o));

    // Path geometry
    var desc5 = new ActionDescriptor();
    var list1 = new ActionList();
    for (var s = 0; s < subpaths.length; s++) {
        var sub = subpaths[s];
        if (!sub.points || sub.points.length < 2) continue;

        var desc6 = new ActionDescriptor();
        if (o.xor) {
            desc6.putEnumerated(sid("shapeOperation"), sid("shapeOperation"), sid("xor"));
        }
        desc6.putBoolean(sid("closedSubpath"), !!sub.closed);
        var list2 = new ActionList();
        for (var p = 0; p < sub.points.length; p++) {
            var pt = sub.points[p];
            var desc7 = new ActionDescriptor();
            var dA = new ActionDescriptor();
            dA.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), pt.ax);
            dA.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), pt.ay);
            desc7.putObject(sid("anchor"), charIDToTypeID("Pnt "), dA);
            var dO = new ActionDescriptor();
            dO.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), pt.ox);
            dO.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), pt.oy);
            desc7.putObject(sid("forward"), charIDToTypeID("Pnt "), dO);
            var dI = new ActionDescriptor();
            dI.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), pt.ix);
            dI.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), pt.iy);
            desc7.putObject(sid("backward"), charIDToTypeID("Pnt "), dI);
            desc7.putBoolean(sid("smooth"), false);
            list2.putObject(sid("pathPoint"), desc7);
        }
        desc6.putList(sid("points"), list2);
        list1.putObject(sid("subpathListKey"), desc6);
    }
    desc5.putList(sid("pathComponents"), list1);
    desc2.putObject(sid("shape"), sid("pathClass"), desc5);
    desc1.putObject(charIDToTypeID("Usng"), sid("contentLayer"), desc2);
    executeAction(charIDToTypeID("Mk  "), desc1, DialogModes.NO);

    // Rename
    var renDesc = new ActionDescriptor();
    var renRef = new ActionReference();
    renRef.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    renDesc.putReference(charIDToTypeID("null"), renRef);
    var toDesc = new ActionDescriptor();
    toDesc.putString(charIDToTypeID("Nm  "), String(o.name));
    renDesc.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), toDesc);
    executeAction(charIDToTypeID("setd"), renDesc, DialogModes.NO);

    // Layer opacity (element 'opacity', optionally folded fill-opacity)
    if (o.layerOpacity !== undefined && o.layerOpacity < 100) {
        var opDesc = new ActionDescriptor();
        var opRef = new ActionReference();
        opRef.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        opDesc.putReference(charIDToTypeID("null"), opRef);
        var opTo = new ActionDescriptor();
        opTo.putUnitDouble(charIDToTypeID("Opct"), charIDToTypeID("#Prc"), Math.max(0, Math.min(100, o.layerOpacity)));
        opDesc.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), opTo);
        executeAction(charIDToTypeID("setd"), opDesc, DialogModes.NO);
    }
    return app.activeDocument.activeLayer;
}

// ─── GROUP COLLAPSE ──────────────────────────────────────────────────────
// If a group contains exactly one shape in total (no other descendants),
// drop that group level and name the shape layer after the group (when the
// shape only has a generic tag name like 'path').
function collapseSingleShapeGroups(shapes) {
    var counts = {};
    var i, d;
    for (i = 0; i < shapes.length; i++) {
        var gp = shapes[i].groupPath;
        var key = "";
        for (d = 0; d < gp.length; d++) {
            key = key ? key + "/" + gp[d] : gp[d];
            counts[key] = (counts[key] || 0) + 1;
        }
    }
    for (i = 0; i < shapes.length; i++) {
        var sd = shapes[i];
        while (sd.groupPath.length > 0 && counts[sd.groupPath.join("/")] === 1) {
            var gname = sd.groupPath[sd.groupPath.length - 1];
            if (SHAPE_TAGS[sd.name]) sd.name = gname;
            sd.groupPath = sd.groupPath.slice(0, -1);
        }
    }
}

// ─── DEBUG LOG ──────────────────────────────────────────────────────────
var DBG_FILE = null;
function dbgOpen(opts) {
    if (!opts.debug) return;
    try {
        DBG_FILE = new File(Folder.desktop + "/svg_import_log.txt");
        DBG_FILE.open("w");
        DBG_FILE.writeln("SVG Importer v3.1 debug log");
    } catch (e) { DBG_FILE = null; }
}
function dbg(line) {
    if (DBG_FILE) { try { DBG_FILE.writeln(line); } catch (e) {} }
}
function dbgClose() {
    if (DBG_FILE) { try { DBG_FILE.close(); } catch (e) {} DBG_FILE = null; }
}

// ─── VIEWBOX ─────────────────────────────────────────────────────────────────
function parseViewBox(rawSVG) {
    var vb = { x: 0, y: 0, w: 0, h: 0 };
    var m = rawSVG.match(/viewBox\s*=\s*["']([^"']+)["']/i);
    if (m) {
        var p = m[1].replace(/,/g, " ").split(/\s+/);
        vb.x = parseFloat(p[0]) || 0;
        vb.y = parseFloat(p[1]) || 0;
        vb.w = parseFloat(p[2]) || 0;
        vb.h = parseFloat(p[3]) || 0;
    }
    if (vb.w <= 0 || vb.h <= 0) {
        var wm = rawSVG.match(/<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i);
        var hm = rawSVG.match(/<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i);
        vb.w = wm ? parseFloat(wm[1]) : 1024;
        vb.h = hm ? parseFloat(hm[1]) : 1024;
    }
    return vb;
}

// ─── UI ──────────────────────────────────────────────────────────────────────
var UI_BG    = [0.118, 0.118, 0.125];
var UI_TXT   = [0.86, 0.86, 0.88];
var UI_MUTED = [0.55, 0.55, 0.58];

function styleBG(c, rgb)  { try { c.graphics.backgroundColor = c.graphics.newBrush(c.graphics.BrushType.SOLID_COLOR, rgb); } catch (e) {} }
function styleTxt(c, rgb) { try { c.graphics.foregroundColor = c.graphics.newPen(c.graphics.PenType.SOLID_COLOR, rgb, 1); } catch (e) {} }

function buildDialog() {
    var dlg = new Window("dialog", "SVG \u2192 Shape Layers v3.0");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.spacing = 10;
    dlg.margins = 16;
    styleBG(dlg, UI_BG);

    var header = dlg.add("statictext", undefined, "Import SVG files as native Photoshop shape layers");
    styleTxt(header, UI_TXT);
    var sub = dlg.add("statictext", undefined, "Fills \u00b7 Strokes \u00b7 Opacity \u00b7 Layer names \u00b7 Group hierarchy \u00b7 Transforms");
    styleTxt(sub, UI_MUTED);

    // Files
    var pFiles = dlg.add("panel", undefined, " SVG Files ");
    pFiles.orientation = "column";
    pFiles.alignChildren = ["fill", "top"];
    pFiles.margins = 12;
    styleTxt(pFiles, UI_TXT);
    var lst = pFiles.add("listbox", undefined, [], { multiselect: true });
    lst.preferredSize = [460, 130];
    var fileObjs = [];
    var rowF = pFiles.add("group");
    rowF.alignment = "left";
    var btnAdd = rowF.add("button", undefined, "Add\u2026");
    var btnRemove = rowF.add("button", undefined, "Remove");
    var btnClear = rowF.add("button", undefined, "Clear");
    var lblCount = rowF.add("statictext", undefined, "0 files");
    lblCount.preferredSize = [120, 18];
    styleTxt(lblCount, UI_MUTED);

    function refreshCount() { lblCount.text = fileObjs.length + " file" + (fileObjs.length === 1 ? "" : "s"); }

    btnAdd.onClick = function () {
        var sel = File.openDialog("Select SVG files", "*.svg", true);
        if (!sel) return;
        if (!(sel instanceof Array)) sel = [sel];
        for (var i = 0; i < sel.length; i++) {
            var dup = false;
            for (var j = 0; j < fileObjs.length; j++) if (fileObjs[j].fsName === sel[i].fsName) { dup = true; break; }
            if (dup) continue;
            fileObjs.push(sel[i]);
            lst.add("item", decodeURI(sel[i].name));
        }
        refreshCount();
    };
    btnRemove.onClick = function () {
        for (var i = lst.items.length - 1; i >= 0; i--) {
            if (lst.items[i].selected) { lst.remove(i); fileObjs.splice(i, 1); }
        }
        refreshCount();
    };
    btnClear.onClick = function () {
        lst.removeAll();
        fileObjs.length = 0;
        refreshCount();
    };

    // Options
    var pOpt = dlg.add("panel", undefined, " Options ");
    pOpt.orientation = "row";
    pOpt.alignChildren = ["left", "top"];
    pOpt.margins = 12;
    pOpt.spacing = 24;
    styleTxt(pOpt, UI_TXT);

    var colA = pOpt.add("group");
    colA.orientation = "column";
    colA.alignChildren = ["left", "top"];
    var cbFill   = colA.add("checkbox", undefined, "Import fills");          cbFill.value = true;
    var cbStroke = colA.add("checkbox", undefined, "Import strokes");        cbStroke.value = true;
    var cbOpac   = colA.add("checkbox", undefined, "Apply opacity");         cbOpac.value = true;
    var cbCollapse = colA.add("checkbox", undefined, "Collapse single-shape groups"); cbCollapse.value = true;
    var cbDedup    = colA.add("checkbox", undefined, "Skip duplicate shapes");        cbDedup.value = true;

    var colB = pOpt.add("group");
    colB.orientation = "column";
    colB.alignChildren = ["left", "top"];
    var cbGroups = colB.add("checkbox", undefined, "Preserve group hierarchy"); cbGroups.value = true;
    var cbXor    = colB.add("checkbox", undefined, "Even-odd holes (XOR)");     cbXor.value = true;
    var gScale = colB.add("group");
    gScale.add("statictext", undefined, "Scale %");
    var etScale = gScale.add("edittext", undefined, "100");
    etScale.characters = 6;
    var gRes = colB.add("group");
    gRes.add("statictext", undefined, "Resolution");
    var ddRes = gRes.add("dropdownlist", undefined, ["72 ppi", "150 ppi", "300 ppi"]);
    ddRes.selection = 0;
    var gPos = colB.add("group");
    gPos.add("statictext", undefined, "Position");
    var ddPos = gPos.add("dropdownlist", undefined, ["Top-left", "Center on canvas"]);
    ddPos.selection = 0;
    var cbDebug = colB.add("checkbox", undefined, "Write debug log (Desktop)"); cbDebug.value = false;

    // Target
    var pTgt = dlg.add("panel", undefined, " Target ");
    pTgt.orientation = "row";
    pTgt.margins = 12;
    styleTxt(pTgt, UI_TXT);
    var rbNew = pTgt.add("radiobutton", undefined, "New document (fit viewBox \u00d7 scale)");
    var rbActive = pTgt.add("radiobutton", undefined, "Active document");
    rbNew.value = true;
    if (app.documents.length === 0) rbActive.enabled = false;

    // Buttons
    var rowB = dlg.add("group");
    rowB.alignment = "right";
    var btnCancel = rowB.add("button", undefined, "Cancel", { name: "cancel" });
    var btnImport = rowB.add("button", undefined, "Import", { name: "ok" });

    btnImport.onClick = function () {
        if (fileObjs.length === 0) { alert("Add at least one SVG file."); return; }
        dlg.close(1);
    };

    var result = dlg.show();
    if (result !== 1) return null;

    var sc = parseFloat(etScale.text);
    if (isNaN(sc) || sc <= 0) sc = 100;
    return {
        files: fileObjs,
        importFills: cbFill.value,
        importStrokes: cbStroke.value,
        applyOpacity: cbOpac.value,
        preserveGroups: cbGroups.value,
        xor: cbXor.value,
        collapse: cbCollapse.value,
        dedup: cbDedup.value,
        debug: cbDebug.value,
        resolution: [72, 150, 300][ddRes.selection ? ddRes.selection.index : 0],
        centerPos: (ddPos.selection && ddPos.selection.index === 1),
        scale: sc / 100,
        targetNew: rbNew.value
    };
}

function makeProgress(total) {
    var w = new Window("palette", "Importing SVG\u2026", undefined, { closeButton: false });
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    w.margins = 14;
    w.statusText = w.add("statictext", undefined, " ");
    w.statusText.preferredSize = [400, 18];
    w.bar = w.add("progressbar", undefined, 0, Math.max(1, total));
    w.bar.preferredSize = [400, 12];
    w.show();
    return w;
}

function showReport(counters, errors) {
    var dlg = new Window("dialog", "Import Report");
    dlg.orientation = "column";
    dlg.alignChildren = ["fill", "top"];
    dlg.margins = 16;
    styleBG(dlg, UI_BG);
    var ok = dlg.add("statictext", undefined,
        counters.shapes + " shape layer(s) created from " + counters.files + " file(s), " +
        counters.skipped + " skipped (no fill/stroke), " +
        counters.deduped + " duplicate(s) skipped.");
    styleTxt(ok, UI_TXT);
    if (errors.length > 0) {
        var lbl = dlg.add("statictext", undefined, errors.length + " error(s):");
        styleTxt(lbl, UI_TXT);
        var et = dlg.add("edittext", undefined, errors.join("\n"), { multiline: true, readonly: true, scrolling: true });
        et.preferredSize = [460, 160];
    }
    var b = dlg.add("button", undefined, "OK", { name: "ok" });
    b.alignment = "right";
    dlg.show();
}

// ─── IMPORT CORE ─────────────────────────────────────────────────────────────
function importParsed(item, doc, opts, errors, prog, counters) {
    var baseName = decodeURI(item.file.name).replace(/\.svg$/i, "");
    var s = opts.scale;
    var offX = 0, offY = 0;
    if (opts.centerPos) {
        try {
            var dw = doc.width.as ? doc.width.as("px") : parseFloat(doc.width);
            var dh = doc.height.as ? doc.height.as("px") : parseFloat(doc.height);
            offX = (dw - item.vb.w * s) / 2;
            offY = (dh - item.vb.h * s) / 2;
        } catch (eDim) {}
    }
    var viewMatrix = [s, 0, 0, s, -item.vb.x * s + offX, -item.vb.y * s + offY];
    var seenSig = {};

    groupCache = {};
    var fileGroup = makeLayerSet(baseName, null);
    groupCache[""] = fileGroup;

    var shapes = item.shapes;
    // PS inserts new layers at top; reverse iteration preserves SVG document order.
    for (var si = shapes.length - 1; si >= 0; si--) {
        var sd = shapes[si];
        try {
            var fillRGB   = (opts.importFills   && sd.fill)   ? parseColor(sd.fill)   : null;
            var strokeRGB = (opts.importStrokes && sd.stroke) ? parseColor(sd.stroke) : null;
            if (fillRGB === null && strokeRGB === null) { counters.skipped++; continue; }

            if (opts.dedup) {
                var sig = sd.groupPath.join("/") + "|" + sd.name + "|" +
                          (sd.attrs.d ? (sd.attrs.d.length + ":" + sd.attrs.d.substring(0, 48))
                                      : (sd.attrs._tag + ":" + (sd.attrs.points || sd.attrs.cx || "") + ":" + (sd.attrs.x || "")));
                if (seenSig[sig]) { counters.deduped++; dbg("DEDUP  " + sig); continue; }
                seenSig[sig] = true;
            }

            var finalMatrix = multiplyMatrix(viewMatrix, sd.matrix);
            var segs = shapeToSegments(sd.attrs);
            if (!segs || segs.length === 0) { counters.skipped++; continue; }
            transformSegments(segs, finalMatrix);

            var layerOp = 100;
            if (opts.applyOpacity) {
                var op = (sd.opacity !== undefined) ? sd.opacity : 1;
                // Fold fill-opacity into layer opacity when the layer has no stroke
                if (strokeRGB === null && sd.fillOpacity !== undefined) op *= sd.fillOpacity;
                layerOp = Math.round(op * 100);
            }

            var targetGroup = getOrCreateGroup(doc, opts.preserveGroups ? sd.groupPath : [], fileGroup);
            doc.activeLayer = targetGroup;

            var newLyr = createShapeLayer(segs, {
                name: sd.name,
                fill: fillRGB,
                stroke: strokeRGB,
                strokeWidth: (sd.strokeWidth || 1) * matrixScale(finalMatrix),
                strokeOpacity: opts.applyOpacity ? sd.strokeOpacity : 1,
                lineCap: sd.lineCap,
                lineJoin: sd.lineJoin,
                layerOpacity: layerOp,
                xor: opts.xor
            });
            if (newLyr) {
                // Mk contentLayer placement depends on selection state — force
                // the layer into its group deterministically.
                try { newLyr.move(targetGroup, ElementPlacement.INSIDE); } catch (eMv2) {}
                counters.shapes++;
                dbg("LAYER  " + sd.name);
            }
        } catch (e) {
            errors.push(baseName + " / " + sd.name + ": " + e.message);
        }
        if (prog) {
            prog.bar.value++;
            prog.statusText.text = baseName + "  \u2014  " + sd.name;
            try { prog.update(); } catch (e2) {}
        }
    }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function main() {
    var opts = buildDialog();
    if (!opts) return;

    var originalRuler = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var errors = [];
    var counters = { shapes: 0, files: 0, skipped: 0, deduped: 0 };
    dbgOpen(opts);
    var prog = null;

    try {
        // Pre-parse all files (count shapes, get first viewBox for doc sizing)
        var parsed = [];
        var totalShapes = 0;
        for (var f = 0; f < opts.files.length; f++) {
            var file = opts.files[f];
            file.open("r");
            var raw = file.read();
            file.close();
            var nodes = tokenizeSVG(raw);
            var defs = extractDefs(nodes);
            var shapes = walkNodes(nodes, defs);
            if (opts.collapse) collapseSingleShapeGroups(shapes);
            parsed.push({ file: file, vb: parseViewBox(raw), shapes: shapes });
            totalShapes += shapes.length;
        }
        if (totalShapes === 0) {
            alert("No drawable shapes found in the selected file(s).");
            app.preferences.rulerUnits = originalRuler;
            return;
        }

        var doc;
        if (opts.targetNew || app.documents.length === 0) {
            var vb0 = parsed[0].vb;
            doc = app.documents.add(
                Math.max(64, Math.round(vb0.w * opts.scale)),
                Math.max(64, Math.round(vb0.h * opts.scale)),
                opts.resolution || 72, "SVG Import", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
        } else {
            doc = app.activeDocument;
        }

        for (f = 0; f < parsed.length; f++) {
            dbg("PARSE  " + decodeURI(parsed[f].file.name) + "  shapes=" + parsed[f].shapes.length);
        }
        prog = makeProgress(totalShapes);
        for (f = 0; f < parsed.length; f++) {
            importParsed(parsed[f], doc, opts, errors, prog, counters);
            counters.files++;
        }
        app.refresh();
    } catch (e) {
        errors.push("FATAL: " + e.message + (e.line ? " (line " + e.line + ")" : ""));
    }
    if (prog) { try { prog.close(); } catch (e3) {} }
    dbgClose();
    app.preferences.rulerUnits = originalRuler;
    showReport(counters, errors);
}

main();
