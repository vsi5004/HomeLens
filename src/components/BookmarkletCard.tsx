import { useMemo, useState } from "react";

import { isTauri } from "../services/ipc";

/**
 * Builds the "Send to HomeLens" bookmarklet. It runs in the user's own browser
 * on any listing page (including big portals that block server-side fetches),
 * reads the structured data the page already exposes (JSON-LD, Next.js
 * `__NEXT_DATA__`, Open Graph / meta tags) in the user's session, and opens the
 * HomeLens Add-Property form prefilled — no scraping or bot evasion on our side.
 */
function buildBookmarklet(base: string): string {
  const b = base.replace(/\/+$/, "");
  // Compact, self-contained extractor. Mirrors core/src/listing.rs field shape.
  const body = `(function(){
function num(x){if(x==null)return null;if(typeof x==='number')return x;var s=(''+x).replace(/[^0-9.]/g,'');var n=parseFloat(s);return isFinite(n)?n:null;}
function addr(a){if(!a)return null;if(typeof a==='string')return a.trim()||null;if(Array.isArray(a)){for(var i=0;i<a.length;i++){var r=addr(a[i]);if(r)return r;}return null;}var p=[a.streetAddress,a.addressLocality,((a.addressRegion||'')+' '+(a.postalCode||'')).trim()].map(function(x){return(x||'').trim();}).filter(Boolean);return p.length?p.join(', '):null;}
var o={address:null,listPrice:null,beds:null,baths:null,sqft:null,yearBuilt:null,propertyType:null,latitude:null,longitude:null,warnings:[]};
function take(v){if(!v||typeof v!=='object')return;if(!o.address)o.address=addr(v.address);if(o.listPrice==null){var of=v.offers;if(Array.isArray(of))of=of[0];if(of){o.listPrice=num(of.price);if(o.listPrice==null&&of.priceSpecification)o.listPrice=num(of.priceSpecification.price);}if(o.listPrice==null)o.listPrice=num(v.price);}if(o.beds==null)o.beds=num(v.numberOfBedrooms)||num(v.numberOfRooms);if(o.baths==null)o.baths=num(v.numberOfBathroomsTotal)||num(v.numberOfBathrooms);if(o.sqft==null&&v.floorSize)o.sqft=num(v.floorSize.value!=null?v.floorSize.value:v.floorSize);if(o.yearBuilt==null)o.yearBuilt=num(v.yearBuilt);if((o.latitude==null||o.longitude==null)&&v.geo){o.latitude=num(v.geo.latitude);o.longitude=num(v.geo.longitude);}}
function walk(v){if(!v)return;if(Array.isArray(v)){v.forEach(walk);return;}if(typeof v==='object'){if(v['@graph'])walk(v['@graph']);take(v);for(var k in v){if(k==='@graph')continue;var x=v[k];if(x&&typeof x==='object')walk(x);}}}
document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){try{walk(JSON.parse(s.textContent));}catch(e){}});
var nd=document.getElementById('__NEXT_DATA__');if(nd){try{walk(JSON.parse(nd.textContent));}catch(e){}}
function meta(q){var el=document.querySelector(q);return el?el.getAttribute('content'):null;}
if(o.listPrice==null)o.listPrice=num(meta('meta[property="og:price:amount"]')||meta('meta[property="product:price:amount"]'));
if(!o.address){var t=meta('meta[property="og:title"]')||document.title;if(t&&/\\d/.test(t)&&(t.indexOf(',')>=0||/\\d{5}/.test(t)))o.address=t.trim();}
if(o.latitude==null){var g=meta('meta[name="geo.position"]');if(g){var pp=g.split(';');if(pp.length===2){o.latitude=num(pp[0]);o.longitude=num(pp[1]);}}}
o.resolvedUrl=location.href;o.source=location.hostname.replace(/^www\\./,'');
var j=JSON.stringify(o);var e=btoa(unescape(encodeURIComponent(j))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
window.open(${JSON.stringify(b)}+'/#/add?import='+e,'_blank');
})();`;
  return "javascript:" + body.replace(/\n/g, "");
}

export default function BookmarkletCard() {
  const defaultBase =
    !isTauri() && typeof window !== "undefined"
      ? window.location.origin
      : "http://homelens.local:8080";
  const [base, setBase] = useState(defaultBase);
  const [copied, setCopied] = useState(false);

  const href = useMemo(() => buildBookmarklet(base.trim() || defaultBase), [
    base,
    defaultBase,
  ]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="card">
      <h2 className="card-title">"Send to HomeLens" bookmarklet</h2>
      <p className="muted">
        For big portals (Zillow, Realtor.com, RE/MAX…) that block the in-app
        "Autofill from link", use this bookmarklet. On a listing page, click it
        and HomeLens opens with the details prefilled for review.
      </p>

      <label className="field">
        <span className="field-label">HomeLens web address</span>
        <input
          type="text"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="http://homelens.local:8080"
        />
        <span className="field-hint">
          The address you open HomeLens at in a browser (web-server mode). The
          bookmarklet opens a tab there with the listing prefilled.
        </span>
      </label>

      <div className="bookmarklet-actions">
        <a className="btn btn--ghost bookmarklet-link" href={href}>
          📥 Send to HomeLens
        </a>
        <button type="button" className="btn btn--ghost" onClick={copy}>
          {copied ? "Copied ✓" : "Copy bookmarklet"}
        </button>
      </div>
      <p className="field-hint">
        Drag the “Send to HomeLens” button to your bookmarks bar, or copy it and
        create a new bookmark with it as the URL.
      </p>
    </section>
  );
}
