import catalog from '../../restaurants.json';
export type Restaurant = typeof catalog[number];
export const origin = '成都市金牛区马鞍街11号';
export const restaurants: Restaurant[] = catalog;
export const categories=['全部','正餐','火锅串串','小吃面饺','烧烤','咖啡甜品','夜生活'];
export function dianpingSearch(r:Restaurant){return `https://www.dianping.com/search/keyword/8/0_${encodeURIComponent(r.name+' '+r.branch)}`;}
export function directions(r:Restaurant){const p=new URLSearchParams({origin,destination:'成都 '+(r.mapName||r.name)+' '+r.address,mode:'driving',region:'成都',output:'html',coord_type:'bd09ll',src:'webapp.dinnerpoll.friends'});return 'https://api.map.baidu.com/direction?'+p.toString();}
