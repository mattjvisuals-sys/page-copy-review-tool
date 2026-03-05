/**
 * Universal Copy Review Generator
 * Takes raw HTML, auto-tags text elements, injects review toolbar.
 * Works in both browser (DOMParser) and Node (jsdom).
 */

(function(exports) {
  'use strict';

  /* ── Config ── */
  var SKIP_TAGS = new Set([
    'SCRIPT','STYLE','NOSCRIPT','IFRAME','SVG','IMG','VIDEO','AUDIO',
    'BR','HR','INPUT','TEXTAREA','SELECT','CANVAS','OBJECT','EMBED',
    'META','LINK','HEAD','TITLE','BASE'
  ]);

  var LEAF_TAGS = new Set([
    'H1','H2','H3','H4','H5','H6','P','A','BUTTON','SPAN','LABEL',
    'FIGCAPTION','TD','TH','DT','DD','LI','BLOCKQUOTE','CAPTION',
    'SUMMARY','LEGEND'
  ]);

  var BLOCK_CLASS_PATTERNS = [
    /card/i, /item/i, /pillar/i, /testimonial/i, /feature/i,
    /callout/i, /quote/i, /alert/i, /banner/i, /hero/i,
    /pricing/i, /step/i, /benefit/i, /stat/i, /proof/i,
    /review/i, /slide/i, /panel/i, /box/i, /tile/i,
    /faq/i, /accordion/i
  ];

  var EVENT_ATTRS = [
    'onclick','onsubmit','onchange','onmouseover','onmouseout',
    'onfocus','onblur','onload','onerror','onkeydown','onkeyup',
    'onscroll','onresize','ontouchstart','ontouchend'
  ];

  /* ── Helpers ── */

  function slugify(text, maxLen) {
    maxLen = maxLen || 30;
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, maxLen)
      .replace(/-+$/, '');
  }

  function getVisibleText(el) {
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3) { // text node
        text += node.textContent;
      }
    }
    return text.trim();
  }

  function hasSignificantText(el) {
    var text = (el.textContent || '').trim();
    return text.length > 1;
  }

  function isHidden(el) {
    var style = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(style)) return true;
    if (/visibility\s*:\s*hidden/i.test(style)) return true;
    if (el.hasAttribute('hidden')) return true;
    return false;
  }

  function matchesBlockPattern(el) {
    var cls = el.className || '';
    if (typeof cls !== 'string') cls = '';
    var id = el.id || '';
    var combined = cls + ' ' + id;
    for (var i = 0; i < BLOCK_CLASS_PATTERNS.length; i++) {
      if (BLOCK_CLASS_PATTERNS[i].test(combined)) return true;
    }
    return false;
  }

  function isSmartBlock(el) {
    var tag = el.tagName;
    // List items are always blocks
    if (tag === 'LI' && hasSignificantText(el)) return true;
    // Blockquotes
    if (tag === 'BLOCKQUOTE') return true;
    // Elements matching card/callout/etc patterns
    if ((tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'ASIDE') &&
        matchesBlockPattern(el) && hasSignificantText(el)) {
      // Only if it contains child text elements (not just a wrapper of wrappers)
      var childTextEls = el.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,a,button,li');
      if (childTextEls.length > 0 && childTextEls.length <= 10) return true;
    }
    return false;
  }

  function isLeafText(el) {
    var tag = el.tagName;
    if (!LEAF_TAGS.has(tag)) return false;
    if (!hasSignificantText(el)) return false;

    // Skip decorative/logo spans (very short text, usually single words used for styling)
    if (tag === 'SPAN') {
      var text = (el.textContent || '').trim();
      // Skip spans that are purely decorative (gradient text, logos, icons)
      var style = el.getAttribute('style') || '';
      var cls = (el.className || '').toString();
      if (/background-clip|text-fill-color|-webkit-text-fill/i.test(style)) return false;
      if (/logo|icon|dot|pulse|flash|arrow|badge/i.test(cls)) return false;
      // Skip very short spans unless they're inside a heading or are meaningful
      if (text.length <= 3 && !el.closest('h1,h2,h3,h4,h5,h6')) return false;
      var directText = getVisibleText(el);
      if (!directText && el.children.length > 0) return false;
    }

    // Skip links that are just wrappers
    if (tag === 'A') {
      var directText = getVisibleText(el);
      if (!directText && el.children.length > 0) return false;
    }

    // Skip elements we created as placeholders
    if ((el.textContent || '').indexOf('not part of copy review') !== -1) return false;
    if ((el.textContent || '').indexOf('MEDIA EMBED') !== -1) return false;

    return true;
  }

  /* ── Smart Tagger ── */

  function smartTag(doc) {
    var tagged = new Set();
    var idCounts = {};
    var sectionMap = {};
    var currentSection = 'Page';
    var count = 0;

    function makeId(tag, text) {
      var slug = slugify(text) || 'element';
      var base = tag.toLowerCase() + '-' + slug;
      if (idCounts[base] === undefined) {
        idCounts[base] = 0;
      } else {
        idCounts[base]++;
        base = base + '-' + idCounts[base];
      }
      return base;
    }

    function isAlreadyTagged(el) {
      // Check if this element or any ancestor is already tagged
      var node = el;
      while (node && node !== doc.body) {
        if (tagged.has(node)) return true;
        node = node.parentElement;
      }
      return false;
    }

    function isChildOfTagged(el) {
      var node = el.parentElement;
      while (node && node !== doc.body) {
        if (tagged.has(node)) return true;
        node = node.parentElement;
      }
      return false;
    }

    function walk(el) {
      if (!el || !el.tagName) return;
      var tag = el.tagName;

      if (SKIP_TAGS.has(tag)) return;
      if (isHidden(el)) return;
      if (el.hasAttribute('data-cr-placeholder')) return;

      // Track current section from headings
      if (/^H[1-3]$/.test(tag) && hasSignificantText(el)) {
        currentSection = (el.textContent || '').trim().substring(0, 40);
      }

      // Don't tag if ancestor already tagged
      if (isChildOfTagged(el)) return;

      // Check smart block first
      if (isSmartBlock(el)) {
        var blockId = makeId(tag, (el.textContent || '').substring(0, 40));
        el.setAttribute('data-review-id', blockId);
        tagged.add(el);
        sectionMap[blockId] = currentSection;
        count++;
        return; // Skip children
      }

      // Check leaf text
      if (isLeafText(el)) {
        var leafId = makeId(tag, (el.textContent || '').substring(0, 40));
        el.setAttribute('data-review-id', leafId);
        tagged.add(el);
        sectionMap[leafId] = currentSection;
        count++;
        // For LI, skip children
        if (tag === 'LI') return;
      }

      // Recurse children
      var children = el.children;
      for (var i = 0; i < children.length; i++) {
        walk(children[i]);
      }
    }

    walk(doc.body);
    return { count: count, sectionMap: sectionMap };
  }

  /* ── HTML Cleaner ── */

  function cleanHTML(doc) {
    // Remove all script tags
    var scripts = doc.querySelectorAll('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      scripts[i].parentNode.removeChild(scripts[i]);
    }

    // Replace iframes/videos with placeholders
    var embeds = doc.querySelectorAll('iframe, video, object, embed');
    for (var j = embeds.length - 1; j >= 0; j--) {
      var placeholder = doc.createElement('div');
      placeholder.style.cssText = 'background:rgba(100,100,100,0.15);border:1px dashed rgba(150,150,150,0.3);border-radius:8px;padding:30px 20px;text-align:center;margin:16px auto;max-width:700px;';
      placeholder.setAttribute('data-cr-placeholder', 'true');
      placeholder.innerHTML = '<span style="font-size:13px;color:rgba(150,150,150,0.6);font-weight:600;">MEDIA EMBED (not part of copy review)</span>';
      var parent = embeds[j].parentNode;
      // Also try to replace the responsive wrapper if it exists
      if (parent && parent.children.length === 1 &&
          (parent.className || '').match(/responsive|wrapper|embed|player/i)) {
        parent.parentNode.replaceChild(placeholder, parent);
      } else {
        parent.replaceChild(placeholder, embeds[j]);
      }
    }

    // Remove event handler attributes
    var all = doc.querySelectorAll('*');
    for (var k = 0; k < all.length; k++) {
      for (var e = 0; e < EVENT_ATTRS.length; e++) {
        all[k].removeAttribute(EVENT_ATTRS[e]);
      }
      // Remove href="javascript:..." but keep the element
      if (all[k].getAttribute('href') && all[k].getAttribute('href').indexOf('javascript:') === 0) {
        all[k].setAttribute('href', '#');
        all[k].addEventListener && all[k].setAttribute('onclick', '');
      }
    }

    // Fix position:fixed elements (they behave poorly in review context)
    for (var f = 0; f < all.length; f++) {
      var style = all[f].getAttribute('style') || '';
      if (/position\s*:\s*fixed/i.test(style)) {
        all[f].setAttribute('style', style.replace(/position\s*:\s*fixed/gi, 'position:relative'));
      }
    }

    // Also check CSS rules for position:fixed on common classes
    var styles = doc.querySelectorAll('style');
    for (var s = 0; s < styles.length; s++) {
      if (styles[s].textContent) {
        styles[s].textContent = styles[s].textContent.replace(/position\s*:\s*fixed/gi, 'position:relative');
      }
    }

    // Disable forms
    var forms = doc.querySelectorAll('form');
    for (var fm = 0; fm < forms.length; fm++) {
      forms[fm].setAttribute('onsubmit', 'return false');
    }
  }

  /* ── Review Page Builder ── */

  function buildReviewPage(html, options) {
    options = options || {};

    // Parse the HTML
    var parser, doc;
    if (typeof DOMParser !== 'undefined') {
      // Browser
      parser = new DOMParser();
      doc = parser.parseFromString(html, 'text/html');
    } else {
      // Node.js (jsdom)
      var JSDOM = require('jsdom').JSDOM;
      var dom = new JSDOM(html);
      doc = dom.window.document;
    }

    // Clean the HTML
    cleanHTML(doc);

    // Run smart tagger
    var result = smartTag(doc);

    // Build sectionMap JS
    var sectionMapStr = 'var sectionMap = ' + JSON.stringify(result.sectionMap, null, 2) + ';';

    // Inject review styles into <head>
    var reviewStyle = doc.createElement('style');
    reviewStyle.textContent = getReviewCSS();
    doc.head.appendChild(reviewStyle);

    // Inject toolbar HTML at start of body
    var toolbarDiv = doc.createElement('div');
    toolbarDiv.innerHTML = getToolbarHTML();
    // Insert all toolbar children at the beginning of body
    while (toolbarDiv.firstChild) {
      doc.body.insertBefore(toolbarDiv.lastChild, doc.body.firstChild);
    }
    // Move the actual page content down to account for toolbar
    var firstContentEl = doc.body.querySelector('.review-page-content');
    if (!firstContentEl) {
      // Wrap existing body content (after toolbar elements) in a container
      // The toolbar elements are the ones we just inserted
    }

    // Inject review script at end of body
    var reviewScript = doc.createElement('script');
    reviewScript.textContent = sectionMapStr + '\n' + getReviewJS();
    doc.body.appendChild(reviewScript);

    // Serialize back to HTML
    var output;
    if (typeof XMLSerializer !== 'undefined') {
      output = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    } else {
      output = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    }

    return {
      html: output,
      count: result.count,
      sectionMap: result.sectionMap
    };
  }

  /* ── Review CSS ── */

  function getReviewCSS() {
    return [
      '/* === COPY REVIEW TOOL STYLES === */',
      '.cr-toolbar{position:fixed;top:0;left:0;right:0;z-index:999999;background:rgba(15,23,34,0.97);backdrop-filter:blur(12px);border-bottom:2px solid rgba(221,96,76,0.3);padding:10px 20px;display:flex;align-items:center;justify-content:space-between;height:48px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.cr-toolbar h1{font-size:13px;font-weight:700;color:#98C1D9;letter-spacing:1px;text-transform:uppercase;margin:0}',
      '.cr-toolbar-right{display:flex;gap:8px;align-items:center}',
      '.cr-badge{background:rgba(221,96,76,0.15);border:1px solid rgba(221,96,76,0.3);color:#DD604C;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px}',
      '.cr-btn{padding:6px 14px;border-radius:6px;border:none;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:all 0.2s}',
      '.cr-btn-export{background:#DD604C;color:#fff}',
      '.cr-btn-export:hover{background:#c94535}',
      '.cr-btn-clear{background:rgba(255,255,255,0.08);color:rgba(244,242,236,0.5);border:1px solid rgba(152,193,217,0.12)}',
      '.cr-btn-clear:hover{color:#fff}',
      '.cr-btn-notes{background:rgba(152,193,217,0.1);color:#98C1D9;border:1px solid rgba(152,193,217,0.2)}',
      '.cr-btn-notes:hover{background:rgba(152,193,217,0.18)}',
      '.cr-btn-notes.cr-has-notes{background:rgba(74,222,128,0.12);color:#4ade80;border-color:rgba(74,222,128,0.25)}',
      '.cr-btn-mode{background:rgba(152,193,217,0.1);color:#98C1D9;border:1px solid rgba(152,193,217,0.2)}',
      '.cr-tip{position:fixed;top:48px;left:0;right:0;z-index:999998;background:rgba(61,90,128,0.25);border-bottom:1px solid rgba(152,193,217,0.1);padding:6px 20px;text-align:center;font-size:12px;color:rgba(244,242,236,0.5);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.cr-tip strong{color:#98C1D9}',
      '.cr-spacer{height:74px}',
      '[data-review-id]{position:relative;cursor:pointer;transition:outline 0.15s;border-radius:4px}',
      '[data-review-id]:hover{outline:2px dashed rgba(152,193,217,0.4);outline-offset:4px}',
      '[data-review-id].cr-changed{outline:2px solid rgba(74,222,128,0.4);outline-offset:4px}',
      '[data-review-id].cr-changed::after{content:"CHANGED";position:absolute;top:-8px;right:4px;font-size:9px;font-weight:700;letter-spacing:1px;color:#4ade80;background:rgba(26,35,50,0.9);padding:2px 6px;border-radius:3px;pointer-events:none;z-index:10;font-family:-apple-system,sans-serif}',
      '.cr-review-off [data-review-id]{cursor:default!important}',
      '.cr-review-off [data-review-id]:hover{outline:none!important}',
      '.cr-modal-bg{display:none;position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.cr-modal-bg.cr-open{display:flex}',
      '.cr-modal{background:#1a2332;border:1px solid rgba(152,193,217,0.2);border-radius:16px;padding:28px;max-width:580px;width:92%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5)}',
      '.cr-modal-section{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#DD604C;margin-bottom:12px}',
      '.cr-modal-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(152,193,217,0.5);margin-bottom:6px}',
      '.cr-modal-current{font-size:13px;color:rgba(244,242,236,0.55);line-height:1.7;padding:14px;background:rgba(255,255,255,0.03);border:1px solid rgba(152,193,217,0.08);border-radius:8px;margin-bottom:16px;white-space:pre-wrap;max-height:200px;overflow-y:auto}',
      '.cr-modal-change-label{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#4ade80;margin-bottom:6px}',
      '.cr-modal textarea{width:100%;min-height:100px;background:rgba(255,255,255,0.05);border:1px solid rgba(152,193,217,0.12);border-radius:8px;padding:12px;font-family:inherit;font-size:13px;color:#F4F2EC;line-height:1.6;resize:vertical;box-sizing:border-box}',
      '.cr-modal textarea:focus{outline:none;border-color:#DD604C;box-shadow:0 0 0 3px rgba(221,96,76,0.12)}',
      '.cr-modal textarea::placeholder{color:rgba(244,242,236,0.25)}',
      '.cr-modal-actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end}',
      '.cr-modal-btn{padding:8px 16px;border-radius:6px;border:none;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}',
      '.cr-modal-save{background:#4ade80;color:#0f1722}',
      '.cr-modal-save:hover{background:#22c55e}',
      '.cr-modal-cancel{background:rgba(255,255,255,0.06);color:rgba(244,242,236,0.5)}',
      '.cr-modal-cancel:hover{color:#fff}',
      '.cr-modal-remove{background:none;color:rgba(221,96,76,0.5);border:1px solid rgba(221,96,76,0.15);margin-right:auto;font-size:11px}',
      '.cr-modal-remove:hover{color:#DD604C;border-color:#DD604C}',
      '.cr-export-text{background:rgba(0,0,0,0.3);border:1px solid rgba(152,193,217,0.08);border-radius:8px;padding:16px;font-size:12px;color:rgba(244,242,236,0.6);line-height:1.8;white-space:pre-wrap;max-height:55vh;overflow-y:auto;font-family:monospace}',
      '.cr-no-changes{color:rgba(244,242,236,0.25);font-style:italic}',
      '.cr-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#4ade80;color:#0f1722;padding:8px 20px;border-radius:6px;font-size:12px;font-weight:700;z-index:9999999;opacity:0;transition:opacity 0.3s;font-family:-apple-system,sans-serif}',
      '.cr-toast.cr-show{opacity:1}'
    ].join('\n');
  }

  /* ── Toolbar HTML ── */

  function getToolbarHTML() {
    return [
      '<div class="cr-toolbar">',
      '<h1>Copy Review Tool</h1>',
      '<div class="cr-toolbar-right">',
      '<div class="cr-badge" id="cr-change-count">0 Changes</div>',
      '<button class="cr-btn cr-btn-mode" id="cr-mode-btn" onclick="crToggleMode()">Review Mode: ON</button>',
      '<button class="cr-btn cr-btn-clear" onclick="crClearAll()">Clear All</button>',
      '<button class="cr-btn cr-btn-notes" onclick="crShowNotes()">Notes</button>',
      '<button class="cr-btn cr-btn-export" onclick="crShowExport()">Export Changes</button>',
      '</div>',
      '</div>',
      '<div class="cr-tip" id="cr-tip"><strong>Click any text</strong> on the page below to suggest a copy change. Changes auto-save.</div>',
      '<div class="cr-spacer"></div>',
      '<div class="cr-modal-bg" id="cr-edit-modal">',
      '<div class="cr-modal">',
      '<div class="cr-modal-section" id="cr-modal-section"></div>',
      '<div class="cr-modal-label">Current Copy</div>',
      '<div class="cr-modal-current" id="cr-modal-current"></div>',
      '<div class="cr-modal-change-label">Suggested Change</div>',
      '<textarea id="cr-modal-textarea" placeholder="Type your new copy here..."></textarea>',
      '<div class="cr-modal-actions">',
      '<button class="cr-modal-btn cr-modal-remove" id="cr-modal-remove" onclick="crRemoveChange()">Remove</button>',
      '<button class="cr-modal-btn cr-modal-cancel" onclick="crCloseModal()">Cancel</button>',
      '<button class="cr-modal-btn cr-modal-save" onclick="crSaveChange()">Save Change</button>',
      '</div>',
      '</div>',
      '</div>',
      '<div class="cr-modal-bg" id="cr-export-modal">',
      '<div class="cr-modal" style="max-width:660px">',
      '<div class="cr-modal-section">All Submitted Changes</div>',
      '<div class="cr-export-text" id="cr-export-text"></div>',
      '<div class="cr-modal-actions" style="margin-top:14px">',
      '<button class="cr-modal-btn cr-modal-cancel" onclick="document.getElementById(\'cr-export-modal\').classList.remove(\'cr-open\')">Close</button>',
      '<button class="cr-modal-btn cr-modal-save" onclick="crCopyExport()">Copy to Clipboard</button>',
      '</div>',
      '</div>',
      '</div>',
      '<div class="cr-modal-bg" id="cr-notes-modal">',
      '<div class="cr-modal" style="max-width:620px">',
      '<div class="cr-modal-section">General Notes</div>',
      '<p style="font-size:12px;color:rgba(244,242,236,0.4);margin-bottom:12px">Add design notes, general feedback, or comments about anything on the page.</p>',
      '<textarea id="cr-notes-textarea" style="min-height:180px" placeholder="E.g. The hero image feels too dark, can we try a lighter version?&#10;&#10;The CTA buttons should be more prominent..."></textarea>',
      '<div class="cr-modal-actions" style="margin-top:14px">',
      '<button class="cr-modal-btn cr-modal-cancel" onclick="crCloseNotes()">Cancel</button>',
      '<button class="cr-modal-btn cr-modal-save" onclick="crSaveNotes()">Save Notes</button>',
      '</div>',
      '</div>',
      '</div>',
      '<div class="cr-toast" id="cr-toast">Copied to clipboard!</div>'
    ].join('\n');
  }

  /* ── Review JS ── */

  function getReviewJS() {
    return [
      '(function(){',
      'var changes = JSON.parse(localStorage.getItem("crChanges") || "{}");',
      'var currentId = null;',
      'var reviewMode = true;',
      '',
      'function updateCount(){',
      '  var n = Object.keys(changes).length;',
      '  document.getElementById("cr-change-count").textContent = n + " Change" + (n!==1?"s":"");',
      '}',
      'updateCount();',
      '',
      'Object.keys(changes).forEach(function(id){',
      '  var el = document.querySelector(\'[data-review-id="\'+id+\'"]\');',
      '  if(el) el.classList.add("cr-changed");',
      '});',
      '',
      'document.addEventListener("click", function(e){',
      '  if(!reviewMode) return;',
      '  var target = e.target.closest("[data-review-id]");',
      '  if(!target) return;',
      '  if(target.closest(".cr-toolbar") || target.closest(".cr-modal-bg") || target.closest(".cr-tip")) return;',
      '  e.preventDefault();',
      '  e.stopPropagation();',
      '  crOpenModal(target.getAttribute("data-review-id"), target.textContent.trim());',
      '}, true);',
      '',
      'window.crOpenModal = function(id, text){',
      '  currentId = id;',
      '  var section = (sectionMap && sectionMap[id]) || id.replace(/-/g," ");',
      '  document.getElementById("cr-modal-section").textContent = section;',
      '  document.getElementById("cr-modal-current").textContent = text;',
      '  document.getElementById("cr-modal-textarea").value = changes[id] || "";',
      '  document.getElementById("cr-modal-remove").style.display = changes[id] ? "block" : "none";',
      '  document.getElementById("cr-edit-modal").classList.add("cr-open");',
      '  setTimeout(function(){ document.getElementById("cr-modal-textarea").focus(); },100);',
      '};',
      '',
      'window.crCloseModal = function(){',
      '  document.getElementById("cr-edit-modal").classList.remove("cr-open");',
      '  currentId = null;',
      '};',
      '',
      'window.crSaveChange = function(){',
      '  var val = document.getElementById("cr-modal-textarea").value.trim();',
      '  var el = document.querySelector(\'[data-review-id="\'+currentId+\'"]\');',
      '  if(val){',
      '    changes[currentId] = val;',
      '    if(el) el.classList.add("cr-changed");',
      '  } else {',
      '    delete changes[currentId];',
      '    if(el) el.classList.remove("cr-changed");',
      '  }',
      '  localStorage.setItem("crChanges", JSON.stringify(changes));',
      '  updateCount();',
      '  crCloseModal();',
      '};',
      '',
      'window.crRemoveChange = function(){',
      '  var el = document.querySelector(\'[data-review-id="\'+currentId+\'"]\');',
      '  if(el) el.classList.remove("cr-changed");',
      '  delete changes[currentId];',
      '  localStorage.setItem("crChanges", JSON.stringify(changes));',
      '  updateCount();',
      '  crCloseModal();',
      '};',
      '',
      'window.crToggleMode = function(){',
      '  reviewMode = !reviewMode;',
      '  var btn = document.getElementById("cr-mode-btn");',
      '  btn.textContent = "Review Mode: " + (reviewMode ? "ON" : "OFF");',
      '  btn.style.background = reviewMode ? "rgba(152,193,217,0.1)" : "rgba(255,255,255,0.05)";',
      '  btn.style.color = reviewMode ? "#98C1D9" : "rgba(244,242,236,0.3)";',
      '  document.getElementById("cr-tip").style.display = reviewMode ? "block" : "none";',
      '  if(reviewMode){ document.body.classList.remove("cr-review-off"); }',
      '  else { document.body.classList.add("cr-review-off"); }',
      '};',
      '',
      'window.crShowExport = function(){',
      '  var keys = Object.keys(changes);',
      '  var hasNotes = notes.trim().length > 0;',
      '  if(!keys.length && !hasNotes){',
      '    document.getElementById("cr-export-text").innerHTML = \'<span class="cr-no-changes">No changes or notes submitted yet.</span>\';',
      '  } else {',
      '    var text = "COPY REVIEW CHANGES\\n================================\\n\\n";',
      '    if(hasNotes){',
      '      text += "GENERAL NOTES\\n---\\n" + notes.trim() + "\\n\\n\\n";',
      '    }',
      '    keys.forEach(function(id){',
      '      var section = (sectionMap && sectionMap[id]) || id;',
      '      var el = document.querySelector(\'[data-review-id="\'+id+\'"]\');',
      '      var current = el ? el.textContent.trim() : "(could not read)";',
      '      text += section.toUpperCase() + " (" + id + ")\\n";',
      '      text += "---\\n";',
      '      text += "CURRENT:\\n" + current + "\\n\\n";',
      '      text += "CHANGE TO:\\n" + changes[id] + "\\n\\n\\n";',
      '    });',
      '    document.getElementById("cr-export-text").textContent = text;',
      '  }',
      '  document.getElementById("cr-export-modal").classList.add("cr-open");',
      '};',
      '',
      'window.crCopyExport = function(){',
      '  navigator.clipboard.writeText(document.getElementById("cr-export-text").textContent).then(function(){',
      '    var t = document.getElementById("cr-toast");',
      '    t.classList.add("cr-show");',
      '    setTimeout(function(){t.classList.remove("cr-show")},2000);',
      '  });',
      '};',
      '',
      'window.crClearAll = function(){',
      '  if(!Object.keys(changes).length && !notes.trim()) return;',
      '  if(!confirm("Clear all changes and notes?")) return;',
      '  Object.keys(changes).forEach(function(id){',
      '    var el = document.querySelector(\'[data-review-id="\'+id+\'"]\');',
      '    if(el) el.classList.remove("cr-changed");',
      '  });',
      '  changes = {};',
      '  notes = "";',
      '  localStorage.setItem("crChanges","{}");',
      '  localStorage.setItem("crNotes","");',
      '  updateCount();',
      '  updateNotesBtn();',
      '};',
      '',
      'var notes = localStorage.getItem("crNotes") || "";',
      'function updateNotesBtn(){',
      '  var btn = document.querySelector(".cr-btn-notes");',
      '  if(notes.trim()) btn.classList.add("cr-has-notes");',
      '  else btn.classList.remove("cr-has-notes");',
      '}',
      'updateNotesBtn();',
      '',
      'window.crShowNotes = function(){',
      '  document.getElementById("cr-notes-textarea").value = notes;',
      '  document.getElementById("cr-notes-modal").classList.add("cr-open");',
      '  setTimeout(function(){ document.getElementById("cr-notes-textarea").focus(); },100);',
      '};',
      '',
      'window.crCloseNotes = function(){',
      '  document.getElementById("cr-notes-modal").classList.remove("cr-open");',
      '};',
      '',
      'window.crSaveNotes = function(){',
      '  notes = document.getElementById("cr-notes-textarea").value;',
      '  localStorage.setItem("crNotes", notes);',
      '  updateNotesBtn();',
      '  crCloseNotes();',
      '  var t = document.getElementById("cr-toast");',
      '  t.textContent = "Notes saved!";',
      '  t.classList.add("cr-show");',
      '  setTimeout(function(){t.classList.remove("cr-show");t.textContent="Copied to clipboard!"},2000);',
      '};',
      '',
      'document.getElementById("cr-edit-modal").addEventListener("click",function(e){if(e.target===this)crCloseModal()});',
      'document.getElementById("cr-export-modal").addEventListener("click",function(e){if(e.target===this)this.classList.remove("cr-open")});',
      'document.getElementById("cr-notes-modal").addEventListener("click",function(e){if(e.target===this)crCloseNotes()});',
      'document.addEventListener("keydown",function(e){if(e.key==="Escape"){crCloseModal();crCloseNotes();document.getElementById("cr-export-modal").classList.remove("cr-open")}});',
      '})();'
    ].join('\n');
  }

  /* ── Exports ── */
  exports.buildReviewPage = buildReviewPage;
  exports.smartTag = smartTag;
  exports.cleanHTML = cleanHTML;

})(typeof module !== 'undefined' ? module.exports : (window.CopyReview = {}));
