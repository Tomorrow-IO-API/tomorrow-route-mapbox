import * as React from "react";
import MapGL, { Layer, Source } from "react-map-gl";
import { Editor, EditingMode, DrawLineStringMode } from "react-map-gl-draw";
import Geocoder from "react-map-gl-geocoder";
import "react-map-gl-geocoder/dist/mapbox-gl-geocoder.css";
import axios from "axios";
import simplify from "simplify-geojson";

class App extends React.Component {
  static defaultProps = {
    // get your key from app.tomorrow.io/development/keys
    // ideally the request will be proxied by another server-side service, keeping the key secure
    apikey: "add your API key here",
    // grab your mapbox token from account.mapbox.com/
    token:
      "add your Mapbox token here",
    // list the fields, since we're querying polylines (route legs) you can also specify Min/Max/Avg suffixes
    fields: ["precipitationIntensity"],
  };

  constructor(props) {
    super(props);
    this.state = {
      // start by drawing the route
      mode: new DrawLineStringMode(),
      // set the default viewport
      viewport: {
        width: 800,
        height: 600,
        longitude: -122.45,
        latitude: 37.78,
        zoom: 14,
      },
      // set the default settings
      settings: {
        dragPan: true,
        dragRotate: false,
        scrollZoom: true,
        touchZoom: false,
        touchRotate: false,
        keyboard: false,
        doubleClickZoom: false,
        minZoom: 10,
        maxZoom: 14,
        minPitch: 0,
        maxPitch: 85,
      },
      features: [],
    };
    this.geoRef = React.createRef();
    this.editorRef = React.createRef();
    this.mapRef = React.createRef();
  }

  componentDidUpdate = (prevProps, prevState) => {
    const props = this.props;
    const { fields, apikey, token } = props;
    const { features, selectedFeature, mode } = this.state;
    let legs;
    // request directions for waypoints, only when they are finalized (deselected)
    if (
      features.length > 0 &&
      !selectedFeature &&
      (selectedFeature !== prevState.selectedFeature || mode !== prevState.mode)
    ) {
      axios({
        method: "get",
        // set the mapbox Directions GET endpoint as the target URL
        url: `https://api.mapbox.com/directions/v5/mapbox/driving/${features[0].geometry.coordinates
          .map((coordinate) => coordinate.join(","))
          .join(";")}?geometries=geojson&steps=true&access_token=${token}`,
      }).then((response) => {
        // merge all the steps into an array matching the segments structure
        legs = response.data.routes[0].legs
          .map((leg) => {
            // save the original route steps to be renders on the map
            return leg.steps.map((step) => ({
              duration: step.duration,
              location: step.geometry,
            }));
          })
          .flat();
        axios({
          method: "post",
          // set the Route POST endpoint as the target URL
          url: `https://api.tomorrow.io/v4/route?apikey=${apikey}`,
          data: {
            fields,
            // simplify complex legs and ensure minimal duration of 5min
            legs: legs.map((leg) => ({
              duration: leg.duration / 60 < 5 ? 5 : leg.duration / 60,
              location: simplify(
                {
                  type: "Feature",
                  properties: {},
                  geometry: leg.location,
                },
                0.001
              ).geometry,
            })),
          },
        })
          .then((response) => {
            // calculate the max value for each field in each leg
            response.data.data.route.map((leg, index) => {
              legs[index].values = {};
              fields.map((field) => {
                legs[index].values[field] = Math.max(
                  ...leg.timeline.intervals.map(
                    (interval) => interval.values[field]
                  )
                );
              });
            });
            // save legs data, to be used when rendering the map
            this.setState({ legs });
          })
          .catch(function (error) {
            console.log(error);
          });
      });
    }
  };

  onViewportChange = (viewport) => {
    this.setState({ viewport });
  };

  onEditorUpdate = ({ data, editType }) => {
    this.setState({
      features: data,
      mode: editType === "addFeature" ? new EditingMode() : this.state.mode,
    });
  };

  onEditorSelect = ({ selectedFeature }) => {
    this.setState({ selectedFeature });
  };
  
  calculateRisk = ({precipitationIntensity}) => {
    // violent rain (>50mm/hr)
    if (precipitationIntensity > 50){
      return 3;
    }    
    // heavy rain (10-50mm/hr)
    if (precipitationIntensity > 10 && precipitationIntensity <=50){
      return 3;
    }    
    // moderate rain (2.5-10mm/hr)
    if (precipitationIntensity > 2.5 && precipitationIntensity <=10){
      return 2;
    }    
    // light rain (<2.5mm/hr), low windgust
    if (precipitationIntensity <= 2.5){
      return 1;
    }
    return 0;
  }

  render() {
    const { viewport, features, mode, legs, settings } = this.state;
    const { token } = this.props;
    // convert legs into standard geojson data, to be visualized on the map - stylized by properties
    const data = legs && {
      type: "FeatureCollection",
      features: legs.map((leg) => ({
        type: "Feature",
        properties: {
          ...leg.values,
          risk: this.calculateRisk(leg.values),
          duration: leg.duration,
        },
        geometry: leg.location,
      })),
    };
    data && console.log(data);
    return (
      <div style={{ height: "100vh" }}>
        <div
          ref={this.geoRef}
          style={{ position: "absolute", top: 20, left: 20, zIndex: 2 }}
        />
        <div
          style={{
            textAlign: "left",
            position: "absolute",
            zIndex: 1,
            lineHeight: "1.5",
            top: "80px",
            left: "20px",
            width: "228px",
            background: "white",
            padding: "6px",
            boxShadow: "0 0 10px 2px rgb(0 0 0 / 10%)",
            borderRadius: "4px",
            fontSize: "10px",
            fontFamily:
              "Open Sans, Helvetica Neue, Arial, Helvetica, sans-serif",
            color: "#000000bf",
          }}
        >
          <strong>Instructions:</strong> click map to create waypoints, double
          click to confirm - reselect route to edit is at any time
        </div>
        <MapGL
          {...viewport}
          {...settings}
          width="100%"
          height="100%"
          mapStyle={"mapbox://styles/mapbox/light-v9"}
          onViewportChange={this.onViewportChange}
          mapboxApiAccessToken={token}
          ref={this.mapRef}
        >
          <Editor
            clickRadius={12}
            onUpdate={this.onEditorUpdate}
            features={features}
            mode={mode}
            ref={this.editorRef}
            onSelect={this.onEditorSelect}
          />
          <Geocoder
            mapRef={this.mapRef}
            containerRef={this.geoRef}
            onViewportChange={this.onViewportChange}
            mapboxApiAccessToken={token}
            position="top-left"
          />
          {legs && (
            <Source type="geojson" data={data}>
              <Layer
                {...{
                  id: "data",
                  type: "line",
                  paint: {
                    "line-color": {
                      property: "risk",
                      stops: [
                        [0, "#91A6DA"], // unknown
                        [1, "#FFFF42"], // minor
                        [2, "#FF7800"], // moderate
                        [3, "#EB002C"], // severe
                        [4, "#B80D09"], // extreme
                      ],
                    },
                    "line-width": 3
                  },
                }}
              />
            </Source>
            // you can also add Popovers, Markers etc - see http://visgl.github.io/react-map-gl/ for more information
          )}
        </MapGL>
      </div>
    );
  }
}

export default App;
