importScripts('gpu-browser.min.js');

(function() {

var extend = function(a) {
    for(var i = 1; i < arguments.length; i++) {
        var b = arguments[i];
        for(var c in b) {
            a[c] = b[c];
        }
    }
    return a;
}

var V3 = function(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
}
V3.prototype = {
    // iop -> inplace
    // ops -> scalar
    add: function(v) {
        return new V3(this.x+v.x, this.y+v.y, this.z+v.z);
    },
    iadd: function(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
    },
    sub: function(v) {
        return new V3(this.x-v.x, this.y-v.y, this.z-v.z);
    },
    mul: function(v) {
        return new V3(this.x*v.x, this.y*v.y, this.z*v.z);
    },
    div: function(v) {
        return new V3(this.x/v.x, this.y/v.y, this.z/v.z);
    },
    muls: function(s) {
        return new V3(this.x*s, this.y*s, this.z*s);
    },
    divs: function(s) {
        return this.muls(1.0/s);
    },
    dot: function(v) {
        return this.x*v.x+this.y*v.y+this.z*v.z;
    },
    normalize: function(){
        return this.divs(Math.sqrt(this.dot(this)));
    }
};


function getRandomNormalInHemisphere(v){
    do {
        var v2 = new V3(Math.random()*2.0-1.0, Math.random()*2.0-1.0, Math.random()*2.0-1.0);
    } while(v2.dot(v2) > 1.0);
    // should only require about 1.9 iterations of average
    v2 = v2.normalize();
    // if the point is in the wrong hemisphere, mirror it
    if(v2.dot(v) < 0.0) {
        return v2.muls(-1);
    }
    return v2;
}

var Camera = function(origin, topleft, topright, bottomleft) {
    this.origin = origin;
    this.topleft = topleft;
    this.topright = topleft;
    this.bottomleft = bottomleft;

    this.xd = topright.sub(topleft);
    this.yd = bottomleft.sub(topleft);
}
Camera.prototype = {
    getRay: function(x, y) {
        // point on screen plane
        var p = this.topleft.add(this.xd.muls(x)).add(this.yd.muls(y));
        return {
            origin: this.origin,
            direction: p.sub(this.origin).normalize()
        };
    }
};

var Sphere = function(center, radius) {
    this.center = center;
    this.radius = radius;
    this.radius2 = radius*radius;
};
Sphere.prototype = {
    // returns distance when ray intersects with sphere surface
    intersect: function(ray) {
        var distance = ray.origin.sub(this.center);
        var b = distance.dot(ray.direction);
        var c = distance.dot(distance) - this.radius2;
        var d = b*b - c;
        return d > 0 ? -b - Math.sqrt(d) : -1;
    },
    getNormal: function(point) {
        return point.sub(this.center).normalize();
    }
};

var Material = function(color, emission) {
    this.color = color;
    this.emission = emission || new V3(0.0, 0.0, 0.0);
}
Material.prototype = {
    bounce: function(ray, normal) {
        return getRandomNormalInHemisphere(normal);
    }
};

var Chrome = function(color) {
    Material.call(this, color);
}
Chrome.prototype = extend({}, Material.prototype, {
    bounce: function(ray, normal) {
        var theta1 = Math.abs(ray.direction.dot(normal));
        return ray.direction.add(normal.muls(theta1*2.0));
    }
});

var Glass = function(color, ior, reflection) {
    Material.call(this, color);
    this.ior = ior;
    this.reflection = reflection;
}
Glass.prototype = extend({}, Material.prototype, {
    bounce: function(ray, normal) {
        var theta1 = Math.abs(ray.direction.dot(normal));
        if(theta1 >= 0.0) {
            var internalIndex = this.ior;
            var externalIndex = 1.0;
        }
        else {
            var internalIndex = 1.0;
            var externalIndex = this.ior;
        }
        var eta = externalIndex/internalIndex;
        var theta2 = Math.sqrt(1.0 - (eta * eta) * (1.0 - (theta1 * theta1)));
        var rs = (externalIndex * theta1 - internalIndex * theta2) / (externalIndex*theta1 + internalIndex * theta2);
        var rp = (internalIndex * theta1 - externalIndex * theta2) / (internalIndex*theta1 + externalIndex * theta2);
        var reflectance = (rs*rs + rp*rp);
        // reflection
        if(Math.random() < reflectance+this.reflection) {
            return ray.direction.add(normal.muls(theta1*2.0));
        }
        // refraction
        return (ray.direction.add(normal.muls(theta1)).muls(eta).add(normal.muls(-theta2)));
        //return ray.direction.muls(eta).sub(normal.muls(theta2-eta*theta1));
    }
});

var Body = function(shape, material) {
    this.shape = shape;
    this.material = material;
}

var Renderer = function(scene) {
    this.scene = scene;
    this.buffer = [];
    for(var i = 0; i < scene.output.width*scene.output.height;i++){
        this.buffer.push(new V3(0.0, 0.0, 0.0));
    }

}
Renderer.prototype = {
    clearBuffer: function() {
        for(var i = 0; i < this.buffer.length; i++) {
            this.buffer[i].x = 0.0;
            this.buffer[i].y = 0.0;
            this.buffer[i].z = 0.0;
        }
    },
    iterate: function() {
        var scene = this.scene;
        var w = scene.output.width;
        var h = scene.output.height;
        var i = 0;
        // randomly jitter pixels so there is no aliasing
        for(var y = Math.random()/h, ystep = 1.0/h; y < 0.99999; y += ystep){
            for(var x = Math.random()/w, xstep = 1.0/w; x < 0.99999; x += xstep){
                var ray = scene.camera.getRay(x, y);
                var color = this.trace(ray, 0);
                this.buffer[i++].iadd(color);
            }
        }
    },
    trace: function(ray, n) {
        var mint = Infinity;
        // trace no more than 5 bounces
        if(n > 4) {
            return new V3(0.0, 0.0, 0.0);
        }
 
        var hit = null;
        for(var i = 0; i < this.scene.objects.length;i++){
            var o = this.scene.objects[i];
            var t = o.shape.intersect(ray);
            if(t > 0 && t <= mint) {
                mint = t;
                hit = o;
            }
        }

        if(hit == null) {
            return new V3(0.0, 0.0, 0.0);
        }
 
        var point = ray.origin.add(ray.direction.muls(mint));
        var normal = hit.shape.getNormal(point);
        var direction = hit.material.bounce(ray, normal);
        // if the ray is refractedmove the intersection point a bit in
        if(direction.dot(ray.direction) > 0.0) {
            point = ray.origin.add(ray.direction.muls(mint*1.0000001));
        }
        // otherwise move it out to prevent problems with floating point
        // accuracy
        else {
            point = ray.origin.add(ray.direction.muls(mint*0.9999999));
        }
        var newray = {origin: point, direction: direction};
        return this.trace(newray, n+1).mul(hit.material.color).add(hit.material.emission);
    }
}
var m = 30;
var l = 1;
var main = function(width, height, iterationsPerMessage, serialize) {
    var scene = {
        output: {width: width, height: height},
        camera: new Camera(
            new V3(0.0, -m*.8, m*0.2),
            new V3(-l*m, l*m, l*m),
            new V3(l*m, l*m, l*m),
            new V3(-l*m, l*m, -l*m)
        ),
        objects: [
            // glowing sphere
          //  new Body(new Sphere(new V3(0.0, 4.0, 5.0), 0.5), new Material(new V3(0.1, 0.4, 0.9), new V3(7, 6, 6))),
            // glass sphere
          //  new Body(new Sphere(new V3(2.1, -5.0, 2.3), 1.6), new Glass(new V3(1, 1, 1), 1.5, 0.1)),
            // chrome sphere
          //  new Body(new Sphere(new V3(-2.1, -5.0, 2.3), 1.7), new Chrome(new V3(0.8, 0.8, 0.8))),
            // chrome sphere
            new Body(new Sphere(new V3(0, 2, 4.3), 3), new Chrome(new V3(0.8, 0.8, 0.8))),
            // floor
            new Body(new Sphere(new V3(0.0, 3.5, -10e6), 10e6), new Material(new V3(0.4, 0.2, 0))),
            // back
            new Body(new Sphere(new V3(0.0, 10e6+40, 0.0), 10e6-4.5), new Material(new V3(0.1, 0.3, 0.4))),
            // left
            new Body(new Sphere(new V3(-10e6-40, 3.5, 0.0), 10e6-1.9), new Material(new V3(0.1, 0.3, 0.4))),
            // right
            new Body(new Sphere(new V3(10e6+40, 3.5, 0.0), 10e6-1.9), new Material(new V3(0.1, 0.3, 0.4))),
            // top light, the emmision should be close to that of warm sunlight (~5400k)
            new Body(new Sphere(new V3(0.0, 0.0, 10e6+40), 10e6-10.5), new Material(new V3(0.0, 0.0, 0.2), new V3(2.9, 2.9, 2.9))),
            // front
            new Body(new Sphere(new V3(0.0, -10e6-40, 0.0), 10e6-2.5), new Material(new V3(0.1, 0.3, 0.4))),
        ]
    }
    var renderer = new Renderer(scene);
    var buffer = [];
    while(true) {
        for(var x = 0; x < iterationsPerMessage; x++) {
            renderer.iterate();
        }
        postMessage(serializeBuffer(renderer.buffer, serialize));
        renderer.clearBuffer();
    }
}

var serializeBuffer = function(rbuffer, json) {
    var buffer = [];
    for(var i = 0; i < rbuffer.length; i++){
        buffer.push(rbuffer[i].x);
        buffer.push(rbuffer[i].y);
        buffer.push(rbuffer[i].z);
    }
    return json ? JSON.stringify(buffer) : buffer;
}

onmessage = function(message) {
    var data = message.data;
    var serialize = false;



            /*const gpu = new GPU();      
            const kernel = gpu.createKernel(test).setOutput([data[0] * data[1]]);
            postMessage(kernel(data[0], data[1], data[2], serialize));*/
            

    if(typeof(data) == 'string') {
        data = JSON.parse('['+data+']');
        serialize = true;
    }
    main(data[0], data[1], data[2], serialize);
}

var test = function(width, height, iterationsPerMessage, serialize) {
    return [this.thread.x , this.thread.y];
}


})();


/*
importScripts('gpu-browser.min.js');

(function() {

var extend = function(a) {
    for(var i = 1; i < arguments.length; i++) {
        var b = arguments[i];
        for(var c in b) {
            a[c] = b[c];
        }
    }
    return a;
}

var V3 = function(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
}
V3.prototype = {
    // iop -> inplace
    // ops -> scalar
    add: function(v) {
        return new V3(this.x+v.x, this.y+v.y, this.z+v.z);
    },
    iadd: function(v) {
        this.x += v.x;
        this.y += v.y;
        this.z += v.z;
    },
    sub: function(v) {
        return new V3(this.x-v.x, this.y-v.y, this.z-v.z);
    },
    mul: function(v) {
        return new V3(this.x*v.x, this.y*v.y, this.z*v.z);
    },
    div: function(v) {
        return new V3(this.x/v.x, this.y/v.y, this.z/v.z);
    },
    muls: function(s) {
        return new V3(this.x*s, this.y*s, this.z*s);
    },
    divs: function(s) {
        return this.muls(1.0/s);
    },
    dot: function(v) {
        return this.x*v.x+this.y*v.y+this.z*v.z;
    },
    normalize: function(){
        return this.divs(Math.sqrt(this.dot(this)));
    }
};


 // This is my crude way of generating random normals in a hemisphere.
 // In the first step I generate random vectors with components
 // from -1 to 1. As this introduces a bias I discard all the points
 // outside of the unit sphere. Now I've got a random normal vector.
 // The last step is to mirror the point if it is in the wrong hemisphere. 
function getRandomNormalInHemisphere(v){
    do {
        var v2 = new V3(Math.random()*2.0-1.0, Math.random()*2.0-1.0, Math.random()*2.0-1.0);
    } while(v2.dot(v2) > 1.0);
    // should only require about 1.9 iterations of average
    v2 = v2.normalize();
    // if the point is in the wrong hemisphere, mirror it
    if(v2.dot(v) < 0.0) {
        return v2.muls(-1);
    }
    return v2;
}


 // The camera is defined by an eyepoint (origin) and three corners
 // of the view plane (it's a rect in my case...)
 
var Camera = function(origin, topleft, topright, bottomleft) {
    this.origin = origin;
    this.topleft = topleft;
    this.topright = topleft;
    this.bottomleft = bottomleft;

    this.xd = topright.sub(topleft);
    this.yd = bottomleft.sub(topleft);
}
Camera.prototype = {
    getRay: function(x, y) {
        // point on screen plane
        var p = this.topleft.add(this.xd.muls(x)).add(this.yd.muls(y));
        return {
            origin: this.origin,
            direction: p.sub(this.origin).normalize()
        };
    }
};

var Sphere = function(center, radius) {
    this.center = center;
    this.radius = radius;
    this.radius2 = radius*radius;
};
Sphere.prototype = {
    // returns distance when ray intersects with sphere surface
    intersect: function(ray) {
        var distance = ray.origin.sub(this.center);
        var b = distance.dot(ray.direction);
        var c = distance.dot(distance) - this.radius2;
        var d = b*b - c;
        return d > 0 ? -b - Math.sqrt(d) : -1;
    },
    getNormal: function(point) {
        return point.sub(this.center).normalize();
    }
};

var Material = function(color, emission) {
    this.color = color;
    this.emission = emission || new V3(0.0, 0.0, 0.0);
}
Material.prototype = {
    bounce: function(ray, normal) {
        return getRandomNormalInHemisphere(normal);
    }
};

var Chrome = function(color) {
    Material.call(this, color);
}
Chrome.prototype = extend({}, Material.prototype, {
    bounce: function(ray, normal) {
        var theta1 = Math.abs(ray.direction.dot(normal));
        return ray.direction.add(normal.muls(theta1*2.0));
    }
});

var Glass = function(color, ior, reflection) {
    Material.call(this, color);
    this.ior = ior;
    this.reflection = reflection;
}
Glass.prototype = extend({}, Material.prototype, {
    bounce: function(ray, normal) {
        var theta1 = Math.abs(ray.direction.dot(normal));
        if(theta1 >= 0.0) {
            var internalIndex = this.ior;
            var externalIndex = 1.0;
        }
        else {
            var internalIndex = 1.0;
            var externalIndex = this.ior;
        }
        var eta = externalIndex/internalIndex;
        var theta2 = Math.sqrt(1.0 - (eta * eta) * (1.0 - (theta1 * theta1)));
        var rs = (externalIndex * theta1 - internalIndex * theta2) / (externalIndex*theta1 + internalIndex * theta2);
        var rp = (internalIndex * theta1 - externalIndex * theta2) / (internalIndex*theta1 + externalIndex * theta2);
        var reflectance = (rs*rs + rp*rp);
        // reflection
        if(Math.random() < reflectance+this.reflection) {
            return ray.direction.add(normal.muls(theta1*2.0));
        }
        // refraction
        return (ray.direction.add(normal.muls(theta1)).muls(eta).add(normal.muls(-theta2)));
        //return ray.direction.muls(eta).sub(normal.muls(theta2-eta*theta1));
    }
});

var Body = function(shape, material) {
    this.shape = shape;
    this.material = material;
}

var Renderer = function(scene) {
    this.scene = scene;
    this.buffer = [];
    for(var i = 0; i < scene.output.width*scene.output.height;i++){
        this.buffer.push(new V3(0.0, 0.0, 0.0));
    }

}
Renderer.prototype = {
    clearBuffer: function() {
        for(var i = 0; i < this.buffer.length; i++) {
            this.buffer[i].x = 0.0;
            this.buffer[i].y = 0.0;
            this.buffer[i].z = 0.0;
        }
    },
    iterate: function() {
        var scene = this.scene;
        var w = scene.output.width;
        var h = scene.output.height;
        var i = 0;
        // randomly jitter pixels so there is no aliasing
        for(var y = Math.random()/h, ystep = 1.0/h; y < 0.99999; y += ystep){
            for(var x = Math.random()/w, xstep = 1.0/w; x < 0.99999; x += xstep){
                var ray = scene.camera.getRay(x, y);
                var color = this.trace(ray, 0);
                this.buffer[i++].iadd(color);
            }
        }
    },
    trace: function(ray, n) {
        var mint = Infinity;
        // trace no more than 5 bounces
        if(n > 4) {
            return new V3(0.0, 0.0, 0.0);
        }
 
        var hit = null;
        for(var i = 0; i < this.scene.objects.length;i++){
            var o = this.scene.objects[i];
            var t = o.shape.intersect(ray);
            if(t > 0 && t <= mint) {
                mint = t;
                hit = o;
            }
        }

        if(hit == null) {
            return new V3(0.0, 0.0, 0.0);
        }
 
        var point = ray.origin.add(ray.direction.muls(mint));
        var normal = hit.shape.getNormal(point);
        var direction = hit.material.bounce(ray, normal);
        // if the ray is refractedmove the intersection point a bit in
        if(direction.dot(ray.direction) > 0.0) {
            point = ray.origin.add(ray.direction.muls(mint*1.0000001));
        }
        // otherwise move it out to prevent problems with floating point
        // accuracy
        else {
            point = ray.origin.add(ray.direction.muls(mint*0.9999999));
        }
        var newray = {origin: point, direction: direction};
        return this.trace(newray, n+1).mul(hit.material.color).add(hit.material.emission);
    }
}
var m = 30;
var l = 1;
var main = function(width, height, iterationsPerMessage, serialize) {
    var scene = {
        output: {width: width, height: height},
        camera: new Camera(
            new V3(0.0, -m*.8, m*0.2),
            new V3(-l*m, l*m, l*m),
            new V3(l*m, l*m, l*m),
            new V3(-l*m, l*m, -l*m)
        ),
        objects: [
            // glowing sphere
          //  new Body(new Sphere(new V3(0.0, 4.0, 5.0), 0.5), new Material(new V3(0.1, 0.4, 0.9), new V3(7, 6, 6))),
            // glass sphere
          //  new Body(new Sphere(new V3(2.1, -5.0, 2.3), 1.6), new Glass(new V3(1, 1, 1), 1.5, 0.1)),
            // chrome sphere
          //  new Body(new Sphere(new V3(-2.1, -5.0, 2.3), 1.7), new Chrome(new V3(0.8, 0.8, 0.8))),
            // chrome sphere
            new Body(new Sphere(new V3(0, 2, 4.3), 3), new Chrome(new V3(0.8, 0.8, 0.8))),
            // floor
            new Body(new Sphere(new V3(0.0, 3.5, -10e6), 10e6), new Material(new V3(0.4, 0.2, 0))),
            // back
            new Body(new Sphere(new V3(0.0, 10e6+40, 0.0), 10e6-4.5), new Material(new V3(0.1, 0.3, 0.4))),
            // left
            new Body(new Sphere(new V3(-10e6-40, 3.5, 0.0), 10e6-1.9), new Material(new V3(0.1, 0.3, 0.4))),
            // right
            new Body(new Sphere(new V3(10e6+40, 3.5, 0.0), 10e6-1.9), new Material(new V3(0.1, 0.3, 0.4))),
            // top light, the emmision should be close to that of warm sunlight (~5400k)
            new Body(new Sphere(new V3(0.0, 0.0, 10e6+40), 10e6-10.5), new Material(new V3(0.0, 0.0, 0.2), new V3(2.9, 2.9, 2.9))),
            // front
            new Body(new Sphere(new V3(0.0, -10e6-40, 0.0), 10e6-2.5), new Material(new V3(0.1, 0.3, 0.4))),
        ]
    }
    var renderer = new Renderer(scene);
    var buffer = [];
    while(true) {
        for(var x = 0; x < iterationsPerMessage; x++) {
            renderer.iterate();
        }
        postMessage(serializeBuffer(renderer.buffer, serialize));
        renderer.clearBuffer();
    }
}

var serializeBuffer = function(rbuffer, json) {
    var buffer = [];
    for(var i = 0; i < rbuffer.length; i++){
        buffer.push(rbuffer[i].x);
        buffer.push(rbuffer[i].y);
        buffer.push(rbuffer[i].z);
    }
    return json ? JSON.stringify(buffer) : buffer;
}

onmessage = function(message) {
    var data = message.data;
    var serialize = false;

    if(typeof(data) == 'string') {
        data = JSON.parse('['+data+']');
        serialize = true;
    }

            const gpu = new GPU();      
            const kernel = gpu.createKernel(test).setOutput([10]);
            postMessage(kernel(data[0], data[1], data[2], serialize));
          
    //main(data[0], data[1], data[2], serialize);
}

var test = function(width, height, iterationsPerMessage, serialize) {
    const r = serialize;       
    
    return this.thread.x;
}


})();*/