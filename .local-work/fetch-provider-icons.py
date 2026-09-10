import urllib.request,urllib.parse,re,json,io,concurrent.futures
from pathlib import Path
from PIL import Image
sites={'yardi':'https://www.yardi.com','yardi_breeze':'https://www.yardibreeze.com','reapit':'https://www.reapit.com','sme_professional':'https://smeprofessional.co.uk','10ninety':'https://www.10ninety.co.uk','arthur':'https://www.arthuronline.co.uk','joblogic':'https://www.joblogic.com','rentvine':'https://www.rentvine.com','buildingstack':'https://www.buildingstack.com','gohighlevel':'https://www.gohighlevel.com','igloohome':'https://www.igloohome.co','propstack':'https://www.propstack.de','resharmonics':'https://resharmonics.com','realpad':'https://www.realpadsoftware.com','rentvision':'https://www.rentvision.com','showmojo':'https://showmojo.com','tenantcloud':'https://www.tenantcloud.com','street':'https://street.co.uk','yardi_kube':'https://www.yardikube.com','rightmove':'https://www.rightmove.co.uk','zoopla':'https://www.zoopla.co.uk','onthemarket':'https://www.onthemarket.com','microsoft_teams':'https://teams.microsoft.com','onedrive':'https://onedrive.live.com'}
def fetch(url):
 return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=12).read(2_000_000)
def work(pair):
 key,base=pair
 candidates=[]
 try:
  html=fetch(base).decode('utf8','ignore')
  for tag in re.findall(r'<link\b[^>]*>',html,re.I):
   if re.search(r'rel=[\"\'][^\"\']*icon',tag,re.I):
    m=re.search(r'href=[\"\']([^\"\']+)',tag,re.I)
    if m: candidates.append(urllib.parse.urljoin(base,m[1]))
 except Exception: pass
 candidates += [base+'/apple-touch-icon.png',base+'/favicon.ico']
 best=None
 for url in dict.fromkeys(candidates):
  try:
   data=fetch(url); im=Image.open(io.BytesIO(data))
   if im.format=='ICO':
    sz=max(im.ico.sizes()); im=im.ico.getimage(sz)
   if best is None or im.width>best[0].width: best=(im.copy(),url)
  except Exception: pass
 if best:
  im,url=best; im.thumbnail((256,256)); im.convert('RGBA').save('public/brand/providers/'+key+'.png')
  return key,{'path':'/brand/providers/'+key+'.png','source':url,'width':im.width}
 return key,{'missing':base}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 result=dict(pool.map(work,sites.items()))
Path('.local-work/icons.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
